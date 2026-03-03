import { Router, type Request, type Response } from "express";
import type { AdminTokenPayload } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import {
  getAdminOrders,
  updateOrderStatus,
} from "../../app/services/order.server";
import { prisma } from "../../app/db.server";

const router = Router();

type AuthRequest = Request & { adminUser: AdminTokenPayload };

/**
 * GET /api/admin/orders
 * Query: ?status=PROCESSING&sellerId=xxx&country=SA&page=1&limit=50
 *
 * Response:
 * {
 *   orders: [
 *     {
 *       id: "clxxx",
 *       shopifyOrderName: "#1001",
 *       status: "PROCESSING",
 *       customerName: "Ahmed",
 *       shippingCountry: "SA",
 *       totalAmountUsd: "45.00",
 *       seller: { shopName: "MyStore", shopDomain: "mystore.myshopify.com" },
 *       lineItems: [...],
 *       shipments: [...],
 *       createdAt: "2026-03-01T..."
 *     }
 *   ],
 *   total: 85,
 *   page: 1,
 *   limit: 50,
 *   totalPages: 2
 * }
 */
router.get("/", async (req: Request, res: Response) => {
  const { status, sellerId, country, page, limit } = req.query;

  const result = await getAdminOrders({
    status: status as any,
    sellerId: sellerId as string | undefined,
    country: country as string | undefined,
    page: page ? Number(page) : undefined,
    limit: limit ? Number(limit) : undefined,
  });

  return res.json(result);
});

/**
 * GET /api/admin/orders/:id
 *
 * Response: { order: Order with lineItems, shipments, seller }
 */
router.get("/:id", async (req: Request, res: Response) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: {
      seller: { select: { shopName: true, shopDomain: true, packagingInsert: true, brandedPackaging: true } },
      lineItems: { include: { catalogProduct: true, catalogVariant: true } },
      shipments: true,
    },
  });

  if (!order) {
    return res.status(404).json({ error: "Order not found" });
  }

  return res.json({ order });
});

/**
 * PATCH /api/admin/orders/:id/status
 *
 * Request body:
 * {
 *   "status": "PACKED",
 *   "note": "QC passed, ready to ship"
 * }
 *
 * Valid transitions:
 *   PROCESSING → PURCHASED | ALLOCATED | EXCEPTION | CANCELLED
 *   PURCHASED → ALLOCATED | EXCEPTION | CANCELLED
 *   ALLOCATED → PACKED | EXCEPTION | CANCELLED
 *   PACKED → SHIPPED (handled by shipping service)
 *   SHIPPED → DELIVERED | EXCEPTION | RETURNED
 *   PENDING_PAYMENT → PROCESSING (after wallet top-up)
 *
 * Response: { order: Order }
 */
router.patch(
  "/:id/status",
  requireRole("SUPER_ADMIN", "ADMIN", "WAREHOUSE"),
  async (req: Request, res: Response) => {
    const { adminUser } = req as AuthRequest;
    const { status, note } = req.body;

    try {
      const order = await updateOrderStatus(
        req.params.id,
        status,
        adminUser.userId,
        "ADMIN",
        note,
      );
      return res.json({ order });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to update status",
      });
    }
  },
);

/**
 * GET /api/admin/orders/exceptions
 * Get orders with EXCEPTION status for admin review.
 */
router.get("/filters/exceptions", async (_req: Request, res: Response) => {
  const result = await getAdminOrders({ status: "EXCEPTION" });
  return res.json(result);
});

/**
 * GET /api/admin/orders/packing-queue
 * Get orders ready for packing (status: ALLOCATED).
 */
router.get("/filters/packing-queue", async (_req: Request, res: Response) => {
  const result = await getAdminOrders({ status: "ALLOCATED" });
  return res.json(result);
});

/**
 * GET /api/admin/orders/:id/packing-slip
 * Generate packing slip data (for printing).
 *
 * Response includes seller packaging preferences.
 */
router.get("/:id/packing-slip", async (req: Request, res: Response) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: {
      seller: {
        select: {
          shopName: true,
          packagingInsert: true,
          brandedPackaging: true,
          packagingNotes: true,
        },
      },
      lineItems: {
        include: {
          catalogProduct: { select: { sku: true, title: true } },
          catalogVariant: { select: { sku: true, title: true, barcode: true } },
        },
      },
    },
  });

  if (!order) {
    return res.status(404).json({ error: "Order not found" });
  }

  const packingSlip = {
    orderId: order.id,
    shopifyOrderName: order.shopifyOrderName,
    seller: order.seller,
    customer: {
      name: order.customerName,
      address1: order.shippingAddress1,
      address2: order.shippingAddress2,
      city: order.shippingCity,
      province: order.shippingProvince,
      country: order.shippingCountry,
      zip: order.shippingZip,
      phone: order.shippingPhone,
    },
    items: order.lineItems.map((li) => ({
      sku: li.catalogVariant?.sku || li.catalogProduct?.sku || li.sku,
      title: li.title,
      variantTitle: li.variantTitle,
      barcode: li.catalogVariant?.barcode,
      quantity: li.quantity,
    })),
    packaging: {
      brandedPackaging: order.seller.brandedPackaging,
      insertCard: order.seller.packagingInsert,
      notes: order.seller.packagingNotes,
    },
    printedAt: new Date().toISOString(),
  };

  return res.json({ packingSlip });
});

export default router;
