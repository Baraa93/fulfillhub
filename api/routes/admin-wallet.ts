import { Router, type Request, type Response } from "express";
import { prisma } from "../../app/db.server";

const router = Router();

/**
 * GET /api/admin/wallet/transactions
 * Query: ?sellerId=xxx&type=DEBIT&page=1&limit=50
 *
 * All wallet transactions across all sellers (for billing overview).
 */
router.get("/transactions", async (req: Request, res: Response) => {
  const { sellerId, type, page = "1", limit = "50" } = req.query;

  const where: Record<string, unknown> = {};
  if (sellerId) where.sellerId = sellerId;
  if (type) where.type = type;

  const [transactions, total] = await Promise.all([
    prisma.walletTransaction.findMany({
      where: where as any,
      include: {
        seller: { select: { shopName: true, shopDomain: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    }),
    prisma.walletTransaction.count({ where: where as any }),
  ]);

  return res.json({ transactions, total });
});

/**
 * GET /api/admin/wallet/revenue
 * Query: ?days=30
 *
 * Revenue summary: total debits (orders charged) per period.
 */
router.get("/revenue", async (req: Request, res: Response) => {
  const days = Number(req.query.days) || 30;
  const since = new Date();
  since.setDate(since.getDate() - days);

  const result = await prisma.walletTransaction.aggregate({
    where: {
      type: "DEBIT",
      createdAt: { gte: since },
    },
    _sum: { amount: true },
    _count: true,
  });

  return res.json({
    period: `${days}d`,
    totalDebited: result._sum.amount ? Math.abs(Number(result._sum.amount)) : 0,
    transactionCount: result._count,
  });
});

export default router;
