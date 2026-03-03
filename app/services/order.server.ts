import { prisma } from "~/db.server";
import { Prisma, type OrderStatus } from "@prisma/client";
import { deductWallet } from "./wallet.server";
import { logAudit } from "./audit.server";

// ─────────────────────────────────────────────
// Types for Shopify webhook payloads
// ─────────────────────────────────────────────

interface ShopifyLineItem {
  id: number;
  variant_id: number | null;
  title: string;
  variant_title: string | null;
  sku: string | null;
  quantity: number;
  price: string;
}

interface ShopifyAddress {
  name?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  country_code?: string;
  zip?: string;
  phone?: string;
}

interface ShopifyOrder {
  id: number;
  order_number: number;
  name: string;
  email?: string;
  line_items: ShopifyLineItem[];
  shipping_address?: ShopifyAddress;
  total_price: string;
  currency: string;
  created_at: string;
}

// ─────────────────────────────────────────────
// Create internal order from Shopify webhook
// ─────────────────────────────────────────────

export async function createOrderFromWebhook(
  shopDomain: string,
  shopifyOrder: ShopifyOrder,
) {
  // Find seller by shop domain
  const seller = await prisma.seller.findUnique({
    where: { shopDomain },
  });

  if (!seller) {
    throw new Error(`Seller not found for shop: ${shopDomain}`);
  }

  // Map line items to internal SKUs
  const lineItemsData = await Promise.all(
    shopifyOrder.line_items.map(async (item) => {
      // Try to find matching seller product by Shopify variant ID
      const sellerProduct = item.variant_id
        ? await prisma.sellerProduct.findFirst({
            where: {
              sellerId: seller.id,
              shopifyVariantId: String(item.variant_id),
            },
            include: {
              catalogProduct: true,
              catalogVariant: true,
            },
          })
        : null;

      return {
        shopifyLineItemId: String(item.id),
        shopifyVariantId: item.variant_id ? String(item.variant_id) : null,
        title: item.title,
        variantTitle: item.variant_title,
        sku: sellerProduct?.catalogVariant?.sku || item.sku,
        quantity: item.quantity,
        priceUsd: new Prisma.Decimal(item.price),
        costUsd: sellerProduct?.catalogVariant?.priceUsd || null,
        catalogProductId: sellerProduct?.catalogProductId || null,
        catalogVariantId: sellerProduct?.catalogVariantId || null,
        status: "PENDING" as const,
      };
    }),
  );

  // Calculate total cost to deduct from wallet
  const totalCost = lineItemsData.reduce((sum, item) => {
    const cost = item.costUsd
      ? Number(item.costUsd) * item.quantity
      : Number(item.priceUsd) * item.quantity;
    return sum + cost;
  }, 0);

  const addr = shopifyOrder.shipping_address;

  // Determine initial status based on wallet balance
  const hasSufficientBalance = Number(seller.walletBalance) >= totalCost;
  const initialStatus: OrderStatus = hasSufficientBalance
    ? "PROCESSING"
    : "PENDING_PAYMENT";

  // Create order with line items in a transaction
  const order = await prisma.$transaction(async (tx) => {
    const newOrder = await tx.order.create({
      data: {
        sellerId: seller.id,
        shopifyOrderId: String(shopifyOrder.id),
        shopifyOrderNumber: String(shopifyOrder.order_number),
        shopifyOrderName: shopifyOrder.name,
        status: initialStatus,
        customerName: addr?.name || null,
        customerEmail: shopifyOrder.email || null,
        shippingAddress1: addr?.address1 || null,
        shippingAddress2: addr?.address2 || null,
        shippingCity: addr?.city || null,
        shippingProvince: addr?.province || null,
        shippingCountry: addr?.country_code || null,
        shippingZip: addr?.zip || null,
        shippingPhone: addr?.phone || null,
        totalAmountUsd: new Prisma.Decimal(totalCost),
        paidAt: new Date(shopifyOrder.created_at),
        lineItems: {
          create: lineItemsData,
        },
      },
      include: { lineItems: true },
    });

    // Deduct wallet if sufficient
    if (hasSufficientBalance) {
      await deductWallet(
        tx,
        seller.id,
        totalCost,
        `Order ${shopifyOrder.name}`,
        "order",
        newOrder.id,
      );
      await tx.order.update({
        where: { id: newOrder.id },
        data: { walletDeducted: true },
      });
    }

    return newOrder;
  });

  await logAudit({
    actorType: "SYSTEM",
    action: "order.created",
    entityType: "Order",
    entityId: order.id,
    sellerId: seller.id,
    orderId: order.id,
    details: {
      shopifyOrderId: shopifyOrder.id,
      status: initialStatus,
      totalCost,
      lineItemCount: lineItemsData.length,
    },
  });

  return order;
}

// ─────────────────────────────────────────────
// Update order status
// ─────────────────────────────────────────────

export async function updateOrderStatus(
  orderId: string,
  newStatus: OrderStatus,
  actorId: string,
  actorType: "ADMIN" | "SYSTEM",
  note?: string,
) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
  });

  const oldStatus = order.status;

  const updateData: Prisma.OrderUpdateInput = {
    status: newStatus,
    statusNote: note || order.statusNote,
  };

  // Set timestamps based on status
  if (newStatus === "PACKED") updateData.packedAt = new Date();
  if (newStatus === "SHIPPED") updateData.shippedAt = new Date();
  if (newStatus === "DELIVERED") updateData.deliveredAt = new Date();

  const updated = await prisma.order.update({
    where: { id: orderId },
    data: updateData,
  });

  await logAudit({
    actorType,
    actorId,
    action: "order.status_changed",
    entityType: "Order",
    entityId: orderId,
    sellerId: order.sellerId,
    orderId,
    details: { from: oldStatus, to: newStatus, note },
  });

  return updated;
}

// ─────────────────────────────────────────────
// Get orders for seller (multi-tenant scoped)
// ─────────────────────────────────────────────

export async function getSellerOrders(
  sellerId: string,
  options?: {
    status?: OrderStatus;
    page?: number;
    limit?: number;
  },
) {
  const page = options?.page || 1;
  const limit = options?.limit || 20;

  const where: Prisma.OrderWhereInput = { sellerId };
  if (options?.status) where.status = options.status;

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        lineItems: true,
        shipments: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);

  return { orders, total, page, limit, totalPages: Math.ceil(total / limit) };
}

// ─────────────────────────────────────────────
// Get all orders for admin (with filters)
// ─────────────────────────────────────────────

export async function getAdminOrders(options?: {
  status?: OrderStatus;
  sellerId?: string;
  country?: string;
  page?: number;
  limit?: number;
}) {
  const page = options?.page || 1;
  const limit = options?.limit || 50;

  const where: Prisma.OrderWhereInput = {};
  if (options?.status) where.status = options.status;
  if (options?.sellerId) where.sellerId = options.sellerId;
  if (options?.country) where.shippingCountry = options.country;

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        seller: { select: { shopName: true, shopDomain: true } },
        lineItems: true,
        shipments: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);

  return { orders, total, page, limit, totalPages: Math.ceil(total / limit) };
}
