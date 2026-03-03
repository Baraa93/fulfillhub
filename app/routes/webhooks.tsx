import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { shouldProcessWebhook, markWebhookFailed } from "~/services/webhook.server";
import { createOrderFromWebhook } from "~/services/order.server";
import { creditWallet } from "~/services/wallet.server";
import { prisma } from "~/db.server";

/**
 * Shopify webhook handler.
 *
 * Shopify sends webhooks as POST requests with:
 * - X-Shopify-Topic: e.g. "orders/paid"
 * - X-Shopify-Hmac-Sha256: HMAC for verification
 * - X-Shopify-Shop-Domain: e.g. "mystore.myshopify.com"
 * - X-Shopify-Webhook-Id: unique ID for idempotency
 *
 * NOTE: In production, you MUST verify the HMAC signature.
 * The Shopify Remix template handles this via authenticate.webhook().
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const topic = request.headers.get("X-Shopify-Topic") || "";
  const shopDomain = request.headers.get("X-Shopify-Shop-Domain") || "";
  const webhookId = request.headers.get("X-Shopify-Webhook-Id") || "";

  if (!topic || !shopDomain || !webhookId) {
    return json({ error: "Missing webhook headers" }, { status: 400 });
  }

  // Idempotency check
  const payload = await request.json();
  const shouldProcess = await shouldProcessWebhook(
    webhookId,
    topic,
    shopDomain,
    payload,
  );

  if (!shouldProcess) {
    return json({ message: "Duplicate webhook, skipped" }, { status: 200 });
  }

  try {
    switch (topic) {
      case "orders/paid":
        await handleOrderPaid(shopDomain, payload);
        break;

      case "orders/updated":
        await handleOrderUpdated(shopDomain, payload);
        break;

      case "orders/cancelled":
        await handleOrderCancelled(shopDomain, payload);
        break;

      case "app/uninstalled":
        await handleAppUninstalled(shopDomain);
        break;

      default:
        console.log(`Unhandled webhook topic: ${topic}`);
    }

    return json({ success: true }, { status: 200 });
  } catch (error) {
    console.error(`Webhook processing failed [${topic}]:`, error);
    await markWebhookFailed(
      webhookId,
      error instanceof Error ? error.message : "Unknown error",
    );
    // Return 200 to prevent Shopify retries for non-transient errors
    // For transient errors, you'd return 5xx
    return json({ error: "Processing failed" }, { status: 200 });
  }
};

// ─────────────────────────────────────────────
// Webhook Handlers
// ─────────────────────────────────────────────

async function handleOrderPaid(shopDomain: string, payload: unknown) {
  const shopifyOrder = payload as {
    id: number;
    order_number: number;
    name: string;
    email?: string;
    line_items: Array<{
      id: number;
      variant_id: number | null;
      title: string;
      variant_title: string | null;
      sku: string | null;
      quantity: number;
      price: string;
    }>;
    shipping_address?: {
      name?: string;
      address1?: string;
      address2?: string;
      city?: string;
      province?: string;
      country_code?: string;
      zip?: string;
      phone?: string;
    };
    total_price: string;
    currency: string;
    created_at: string;
  };

  await createOrderFromWebhook(shopDomain, shopifyOrder);
  console.log(
    `Order created from webhook: ${shopifyOrder.name} (${shopDomain})`,
  );
}

async function handleOrderUpdated(shopDomain: string, payload: unknown) {
  const shopifyOrder = payload as {
    id: number;
    shipping_address?: {
      name?: string;
      address1?: string;
      address2?: string;
      city?: string;
      province?: string;
      country_code?: string;
      zip?: string;
      phone?: string;
    };
  };

  // Update shipping address if changed
  const seller = await prisma.seller.findUnique({
    where: { shopDomain },
  });
  if (!seller) return;

  const order = await prisma.order.findFirst({
    where: { sellerId: seller.id, shopifyOrderId: String(shopifyOrder.id) },
  });
  if (!order) return;

  const addr = shopifyOrder.shipping_address;
  if (addr) {
    await prisma.order.update({
      where: { id: order.id },
      data: {
        customerName: addr.name || order.customerName,
        shippingAddress1: addr.address1 || order.shippingAddress1,
        shippingAddress2: addr.address2 || order.shippingAddress2,
        shippingCity: addr.city || order.shippingCity,
        shippingProvince: addr.province || order.shippingProvince,
        shippingCountry: addr.country_code || order.shippingCountry,
        shippingZip: addr.zip || order.shippingZip,
        shippingPhone: addr.phone || order.shippingPhone,
      },
    });
  }
}

async function handleOrderCancelled(shopDomain: string, payload: unknown) {
  const shopifyOrder = payload as { id: number };

  const seller = await prisma.seller.findUnique({
    where: { shopDomain },
  });
  if (!seller) return;

  const order = await prisma.order.findFirst({
    where: { sellerId: seller.id, shopifyOrderId: String(shopifyOrder.id) },
  });
  if (!order) return;

  // Only cancel if not already shipped
  if (!["SHIPPED", "DELIVERED"].includes(order.status)) {
    await prisma.order.update({
      where: { id: order.id },
      data: { status: "CANCELLED", statusNote: "Cancelled from Shopify" },
    });

    // Refund wallet if already deducted
    if (order.walletDeducted) {
      await creditWallet(
        seller.id,
        Number(order.totalAmountUsd),
        `Refund for cancelled order ${order.shopifyOrderName}`,
        "refund",
        order.id,
      );
    }
  }
}

async function handleAppUninstalled(shopDomain: string) {
  await prisma.seller.updateMany({
    where: { shopDomain },
    data: { status: "INACTIVE", uninstalledAt: new Date() },
  });
  console.log(`App uninstalled: ${shopDomain}`);
}
