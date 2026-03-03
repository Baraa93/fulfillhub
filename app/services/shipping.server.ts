import { prisma } from "~/db.server";
import type { Carrier } from "@prisma/client";
import { aramexConnector } from "~/carriers/aramex.server";
import { smsaConnector } from "~/carriers/smsa.server";
import { createManualShipmentResponse } from "~/carriers/manual.server";
import { WAREHOUSE_ADDRESS, type ShipmentRequest, type Address } from "~/carriers/types";
import { updateOrderStatus } from "./order.server";
import { logAudit } from "./audit.server";

// ─────────────────────────────────────────────
// Determine carrier based on destination country
// ─────────────────────────────────────────────

export async function determineCarrier(country: string): Promise<Carrier> {
  // Check custom rules first
  const rule = await prisma.shippingRule.findUnique({
    where: { country },
  });

  if (rule?.isActive) {
    return rule.defaultCarrier;
  }

  // Default: KSA → SMSA, others → Aramex
  return country === "SA" ? "SMSA" : "ARAMEX";
}

// ─────────────────────────────────────────────
// Create shipment (API or manual)
// ─────────────────────────────────────────────

interface CreateShipmentInput {
  orderId: string;
  carrier?: Carrier; // manual override
  manualTrackingNumber?: string; // for manual entry
  adminUserId: string;
}

export async function createShipment(input: CreateShipmentInput) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: input.orderId },
    include: {
      seller: true,
      lineItems: { include: { catalogProduct: true } },
    },
  });

  if (!["PACKED", "ALLOCATED", "PURCHASED"].includes(order.status)) {
    throw new Error(
      `Order must be in PACKED/ALLOCATED/PURCHASED status to ship. Current: ${order.status}`,
    );
  }

  // Determine carrier
  const carrier =
    input.carrier || (await determineCarrier(order.shippingCountry || "AE"));

  // Build recipient address
  const recipientAddress: Address = {
    name: order.customerName || "Customer",
    line1: order.shippingAddress1 || "",
    line2: order.shippingAddress2 || undefined,
    city: order.shippingCity || "",
    province: order.shippingProvince || undefined,
    country: order.shippingCountry || "",
    zip: order.shippingZip || "",
    phone: order.shippingPhone || "",
    email: order.customerEmail || undefined,
  };

  let trackingNumber: string;
  let labelUrl: string | undefined;
  let rawResponse: unknown;
  let createdVia: "API" | "MANUAL";

  if (input.manualTrackingNumber) {
    // Manual tracking entry
    const manual = createManualShipmentResponse(
      input.manualTrackingNumber,
      carrier,
    );
    trackingNumber = manual.trackingNumber;
    labelUrl = undefined;
    rawResponse = manual.rawResponse;
    createdVia = "MANUAL";
  } else {
    // API call to carrier
    const connector =
      carrier === "ARAMEX" ? aramexConnector : smsaConnector;

    const totalWeight = order.lineItems.reduce(
      (sum, li) =>
        sum + (li.catalogProduct?.weightKg ? Number(li.catalogProduct.weightKg) * li.quantity : 0.5 * li.quantity),
      0,
    );

    const shipmentRequest: ShipmentRequest = {
      orderId: order.id,
      reference: `FH-${order.shopifyOrderNumber || order.id.slice(0, 8)}`,
      senderAddress: WAREHOUSE_ADDRESS,
      recipientAddress,
      parcels: [
        {
          weightKg: totalWeight || 1,
          description: order.lineItems.map((li) => li.title).join(", "),
          quantity: order.lineItems.reduce((sum, li) => sum + li.quantity, 0),
          value: Number(order.totalAmountUsd),
          currency: "USD",
        },
      ],
      productType: order.shippingCountry === "TR" ? "DOM" : "EXP",
    };

    try {
      const result = await connector.createShipment(shipmentRequest);
      trackingNumber = result.trackingNumber;
      labelUrl = result.labelUrl;
      rawResponse = result.rawResponse;
      createdVia = "API";
    } catch (error) {
      // Log the error but don't fail — admin can retry or enter manually
      console.error(`Carrier API failed for order ${order.id}:`, error);
      throw new Error(
        `Carrier API failed: ${error instanceof Error ? error.message : "Unknown error"}. Use manual tracking entry instead.`,
      );
    }
  }

  // Create shipment record
  const shipment = await prisma.shipment.create({
    data: {
      orderId: order.id,
      carrier,
      trackingNumber,
      labelUrl,
      status: "LABEL_CREATED",
      createdVia,
      carrierRawResponse: rawResponse as object,
      shippedAt: new Date(),
    },
  });

  // Update order status to SHIPPED
  await updateOrderStatus(
    order.id,
    "SHIPPED",
    input.adminUserId,
    "ADMIN",
    `Shipped via ${carrier}, tracking: ${trackingNumber}`,
  );

  // Update order carrier
  await prisma.order.update({
    where: { id: order.id },
    data: {
      assignedCarrier: carrier,
      carrierOverride: !!input.carrier,
    },
  });

  await logAudit({
    actorType: "ADMIN",
    actorId: input.adminUserId,
    action: "shipment.created",
    entityType: "Shipment",
    entityId: shipment.id,
    sellerId: order.sellerId,
    orderId: order.id,
    details: {
      carrier,
      trackingNumber,
      createdVia,
    },
  });

  return shipment;
}

// ─────────────────────────────────────────────
// Get shipments for an order
// ─────────────────────────────────────────────

export async function getOrderShipments(orderId: string) {
  return prisma.shipment.findMany({
    where: { orderId },
    orderBy: { createdAt: "desc" },
  });
}
