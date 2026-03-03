import { Router, type Request, type Response } from "express";
import type { AdminTokenPayload } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { adjustWallet, getWalletTransactions, creditWallet } from "../../app/services/wallet.server";
import { prisma } from "../../app/db.server";

const router = Router();

type AuthRequest = Request & { adminUser: AdminTokenPayload };

/**
 * GET /api/admin/sellers
 * Query: ?status=ACTIVE&search=store&page=1&limit=50
 *
 * Response:
 * {
 *   sellers: [
 *     {
 *       id: "clxxx",
 *       shopDomain: "mystore.myshopify.com",
 *       shopName: "My Store",
 *       status: "ACTIVE",
 *       walletBalance: "500.00",
 *       _count: { orders: 42 }
 *     }
 *   ],
 *   total: 15
 * }
 */
router.get("/", async (req: Request, res: Response) => {
  const { status, search, page = "1", limit = "50" } = req.query;

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { shopName: { contains: search as string, mode: "insensitive" } },
      { shopDomain: { contains: search as string, mode: "insensitive" } },
    ];
  }

  const [sellers, total] = await Promise.all([
    prisma.seller.findMany({
      where: where as any,
      select: {
        id: true,
        shopDomain: true,
        shopName: true,
        email: true,
        status: true,
        walletBalance: true,
        currency: true,
        brandedPackaging: true,
        installedAt: true,
        _count: { select: { orders: true, sellerProducts: true } },
      },
      orderBy: { installedAt: "desc" },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    }),
    prisma.seller.count({ where: where as any }),
  ]);

  return res.json({ sellers, total });
});

/**
 * GET /api/admin/sellers/:id
 */
router.get("/:id", async (req: Request, res: Response) => {
  const seller = await prisma.seller.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      shopDomain: true,
      shopName: true,
      email: true,
      status: true,
      walletBalance: true,
      currency: true,
      packagingInsert: true,
      brandedPackaging: true,
      packagingNotes: true,
      installedAt: true,
      _count: { select: { orders: true, sellerProducts: true, productRequests: true } },
    },
  });

  if (!seller) {
    return res.status(404).json({ error: "Seller not found" });
  }

  return res.json({ seller });
});

/**
 * GET /api/admin/sellers/:id/wallet
 * Get wallet transactions for a seller.
 */
router.get("/:id/wallet", async (req: Request, res: Response) => {
  const { page, limit } = req.query;
  const result = await getWalletTransactions(req.params.id, {
    page: page ? Number(page) : undefined,
    limit: limit ? Number(limit) : undefined,
  });
  return res.json(result);
});

/**
 * POST /api/admin/sellers/:id/wallet/topup
 *
 * Request body:
 * {
 *   "amount": 500,
 *   "description": "Bank transfer received — ref #12345"
 * }
 *
 * Response: { newBalance: 1500, transaction: {...} }
 */
router.post(
  "/:id/wallet/topup",
  requireRole("SUPER_ADMIN", "ADMIN"),
  async (req: Request, res: Response) => {
    const { adminUser } = req as AuthRequest;
    const { amount, description } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Amount must be positive" });
    }

    try {
      const result = await creditWallet(
        req.params.id,
        amount,
        description || "Admin top-up",
        "topup",
        undefined,
        adminUser.userId,
      );
      return res.json(result);
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to top up",
      });
    }
  },
);

/**
 * POST /api/admin/sellers/:id/wallet/adjust
 *
 * Request body:
 * {
 *   "amount": -50,
 *   "reason": "Shipping surcharge for oversized package"
 * }
 *
 * Response: { newBalance: 450, transaction: {...} }
 */
router.post(
  "/:id/wallet/adjust",
  requireRole("SUPER_ADMIN"),
  async (req: Request, res: Response) => {
    const { adminUser } = req as AuthRequest;
    const { amount, reason } = req.body;

    if (amount === undefined || !reason) {
      return res.status(400).json({ error: "Amount and reason required" });
    }

    try {
      const result = await adjustWallet(
        req.params.id,
        amount,
        reason,
        adminUser.userId,
      );
      return res.json(result);
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Adjustment failed",
      });
    }
  },
);

/**
 * PATCH /api/admin/sellers/:id/status
 *
 * Request body: { "status": "SUSPENDED" }
 */
router.patch(
  "/:id/status",
  requireRole("SUPER_ADMIN"),
  async (req: Request, res: Response) => {
    const { status } = req.body;

    const seller = await prisma.seller.update({
      where: { id: req.params.id },
      data: { status },
    });

    return res.json({ seller });
  },
);

export default router;
