import { prisma } from "~/db.server";
import { logAudit } from "./audit.server";
import { getAramexTrackingUrl } from "~/carriers/aramex.server";
import { getSmsaTrackingUrl } from "~/carriers/smsa.server";

// ─────────────────────────────────────────────
// Push tracking to Shopify via Fulfillment API
// ─────────────────────────────────────────────

interface ShopifyFulfillmentLineItem {
  id: number;
  quantity: number;
}

interface FulfillmentOrderLineItem {
  id: number;
  fulfillment_order_id: number;
  line_item_id: number;
  quantity: number;
  remaining_quantity: number;
}

interface FulfillmentOrder {
  id: number;
  order_id: number;
  status: string;
  line_items: FulfillmentOrderLineItem[];
}

/**
 * Push tracking info to Shopify by creating a fulfillment.
 *
 * Shopify 2024-01+ uses FulfillmentOrder-based fulfillment:
 * 1. Get fulfillment orders for the Shopify order
 * 2. Create fulfillment with tracking info
 */
export async function pushTrackingToShopify(
  shipmentId: string,
  adminUserId?: string,
) {
  const shipment = await prisma.shipment.findUniqueOrThrow({
    where: { id: shipmentId },
    include: {
      order: {
        include: {
          seller: true,
          lineItems: true,
        },
      },
    },
  });

  if (!shipment.trackingNumber) {
    throw new Error("Shipment has no tracking number");
  }

  const { order } = shipment;
  const shop = order.seller.shopDomain;
  const accessToken = order.seller.accessToken;
  const apiVersion = "2024-01";

  // Build tracking URL
  const trackingUrl =
    shipment.carrier === "ARAMEX"
      ? getAramexTrackingUrl(shipment.trackingNumber)
      : getSmsaTrackingUrl(shipment.trackingNumber);

  const trackingCompany =
    shipment.carrier === "ARAMEX" ? "Aramex" : "SMSA Express";

  // Step 1: Get fulfillment orders
  const foResponse = await fetch(
    `https://${shop}/admin/api/${apiVersion}/orders/${order.shopifyOrderId}/fulfillment_orders.json`,
    {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
    },
  );

  if (!foResponse.ok) {
    throw new Error(
      `Failed to get fulfillment orders: ${foResponse.status} ${await foResponse.text()}`,
    );
  }

  const foData = await foResponse.json();
  const fulfillmentOrders: FulfillmentOrder[] =
    foData.fulfillment_orders || [];

  // Find open fulfillment orders
  const openFOs = fulfillmentOrders.filter(
    (fo) => fo.status === "open" || fo.status === "in_progress",
  );

  if (openFOs.length === 0) {
    throw new Error(
      "No open fulfillment orders found. Order may already be fulfilled.",
    );
  }

  // Build line_items_by_fulfillment_order
  // For full fulfillment, include all line items. For partial, filter by shipment items.
  const lineItemsByFO = openFOs.map((fo) => ({
    fulfillment_order_id: fo.id,
    fulfillment_order_line_items: fo.line_items
      .filter((li) => li.remaining_quantity > 0)
      .map((li) => ({
        id: li.id,
        quantity: li.remaining_quantity,
      })),
  }));

  // Step 2: Create fulfillment with tracking
  const fulfillmentPayload = {
    fulfillment: {
      line_items_by_fulfillment_order: lineItemsByFO,
      tracking_info: {
        number: shipment.trackingNumber,
        company: trackingCompany,
        url: trackingUrl,
      },
      notify_customer: true,
    },
  };

  const fResponse = await fetch(
    `https://${shop}/admin/api/${apiVersion}/fulfillments.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(fulfillmentPayload),
    },
  );

  if (!fResponse.ok) {
    const errorText = await fResponse.text();
    throw new Error(
      `Failed to create fulfillment: ${fResponse.status} ${errorText}`,
    );
  }

  const fData = await fResponse.json();
  const fulfillmentId = fData.fulfillment?.id;

  // Update shipment record
  await prisma.shipment.update({
    where: { id: shipmentId },
    data: {
      shopifyFulfillmentId: fulfillmentId ? String(fulfillmentId) : null,
      trackingPushed: true,
      trackingUrl,
    },
  });

  await logAudit({
    actorType: adminUserId ? "ADMIN" : "SYSTEM",
    actorId: adminUserId,
    action: "shipment.tracking_pushed",
    entityType: "Shipment",
    entityId: shipmentId,
    sellerId: order.sellerId,
    orderId: order.id,
    details: {
      trackingNumber: shipment.trackingNumber,
      carrier: shipment.carrier,
      shopifyFulfillmentId: fulfillmentId,
    },
  });

  return { fulfillmentId, trackingUrl };
}

/**
 * Update tracking info on an existing Shopify fulfillment.
 */
export async function updateShopifyTracking(
  shipmentId: string,
  newTrackingNumber: string,
  carrier: "ARAMEX" | "SMSA",
) {
  const shipment = await prisma.shipment.findUniqueOrThrow({
    where: { id: shipmentId },
    include: {
      order: { include: { seller: true } },
    },
  });

  if (!shipment.shopifyFulfillmentId) {
    throw new Error("No Shopify fulfillment ID found. Push tracking first.");
  }

  const shop = shipment.order.seller.shopDomain;
  const accessToken = shipment.order.seller.accessToken;
  const apiVersion = "2024-01";

  const trackingUrl =
    carrier === "ARAMEX"
      ? getAramexTrackingUrl(newTrackingNumber)
      : getSmsaTrackingUrl(newTrackingNumber);

  const trackingCompany = carrier === "ARAMEX" ? "Aramex" : "SMSA Express";

  const response = await fetch(
    `https://${shop}/admin/api/${apiVersion}/fulfillments/${shipment.shopifyFulfillmentId}/update_tracking.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fulfillment: {
          tracking_info: {
            number: newTrackingNumber,
            company: trackingCompany,
            url: trackingUrl,
          },
          notify_customer: true,
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to update tracking: ${response.status} ${await response.text()}`,
    );
  }

  await prisma.shipment.update({
    where: { id: shipmentId },
    data: {
      trackingNumber: newTrackingNumber,
      carrier,
      trackingUrl,
    },
  });
}
