import { Router, type Request, type Response } from "express";
import { prisma } from "../../app/db.server";

const router = Router();

/**
 * GET /api/admin/analytics/dashboard
 *
 * Response:
 * {
 *   ordersToday: 12,
 *   ordersPending: 5,
 *   ordersPacked: 3,
 *   ordersShipped: 45,
 *   totalSellers: 15,
 *   activeSellers: 12,
 *   totalRevenue: 15420.50,
 *   lowBalanceSellers: 3
 * }
 */
router.get("/dashboard", async (_req: Request, res: Response) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    ordersToday,
    ordersByStatus,
    sellerCounts,
    lowBalanceSellers,
  ] = await Promise.all([
    prisma.order.count({ where: { createdAt: { gte: today } } }),
    prisma.order.groupBy({
      by: ["status"],
      _count: true,
    }),
    prisma.seller.groupBy({
      by: ["status"],
      _count: true,
    }),
    prisma.seller.count({
      where: { status: "ACTIVE", walletBalance: { lt: 50 } },
    }),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const s of ordersByStatus) {
    statusCounts[s.status] = s._count;
  }

  const sellerStatusCounts: Record<string, number> = {};
  for (const s of sellerCounts) {
    sellerStatusCounts[s.status] = s._count;
  }

  return res.json({
    ordersToday,
    ordersPending: (statusCounts.PROCESSING || 0) + (statusCounts.PENDING_PAYMENT || 0),
    ordersPacked: statusCounts.PACKED || 0,
    ordersShipped: statusCounts.SHIPPED || 0,
    ordersException: statusCounts.EXCEPTION || 0,
    totalSellers:
      (sellerStatusCounts.ACTIVE || 0) +
      (sellerStatusCounts.INACTIVE || 0) +
      (sellerStatusCounts.SUSPENDED || 0),
    activeSellers: sellerStatusCounts.ACTIVE || 0,
    lowBalanceSellers,
  });
});

/**
 * GET /api/admin/analytics/orders
 * Query: ?days=30
 *
 * Returns daily order counts for charting.
 */
router.get("/orders", async (req: Request, res: Response) => {
  const days = Number(req.query.days) || 30;
  const since = new Date();
  since.setDate(since.getDate() - days);

  const orders = await prisma.order.groupBy({
    by: ["status"],
    where: { createdAt: { gte: since } },
    _count: true,
  });

  return res.json({ period: `${days}d`, breakdown: orders });
});

/**
 * GET /api/admin/analytics/top-products
 * Query: ?limit=10
 *
 * Returns most ordered products.
 */
router.get("/top-products", async (req: Request, res: Response) => {
  const limit = Number(req.query.limit) || 10;

  const topProducts = await prisma.orderLineItem.groupBy({
    by: ["catalogProductId"],
    _sum: { quantity: true },
    _count: true,
    orderBy: { _sum: { quantity: "desc" } },
    take: limit,
    where: { catalogProductId: { not: null } },
  });

  // Fetch product details
  const productIds = topProducts
    .map((p) => p.catalogProductId)
    .filter((id): id is string => id !== null);

  const products = await prisma.catalogProduct.findMany({
    where: { id: { in: productIds } },
    select: { id: true, sku: true, title: true, category: true },
  });

  const productMap = new Map(products.map((p) => [p.id, p]));

  return res.json({
    topProducts: topProducts.map((tp) => ({
      product: productMap.get(tp.catalogProductId!) || null,
      totalQuantity: tp._sum.quantity,
      orderCount: tp._count,
    })),
  });
});

export default router;
