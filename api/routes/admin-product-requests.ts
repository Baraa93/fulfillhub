import { Router, type Request, type Response } from "express";
import type { AdminTokenPayload } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import {
  getAdminProductRequests,
  reviewProductRequest,
} from "../../app/services/product-request.server";

const router = Router();

type AuthRequest = Request & { adminUser: AdminTokenPayload };

/**
 * GET /api/admin/product-requests
 * Query: ?status=PENDING&page=1&limit=50
 *
 * Response:
 * {
 *   requests: [
 *     {
 *       id: "clxxx",
 *       trendyolUrl: "https://www.trendyol.com/...",
 *       notes: "Popular in KSA market",
 *       desiredCategory: "Fashion",
 *       status: "PENDING",
 *       seller: { shopName: "MyStore" },
 *       createdAt: "2026-03-01T..."
 *     }
 *   ],
 *   total: 8
 * }
 */
router.get("/", async (req: Request, res: Response) => {
  const { status, page, limit } = req.query;

  const result = await getAdminProductRequests({
    status: status as "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | undefined,
    page: page ? Number(page) : undefined,
    limit: limit ? Number(limit) : undefined,
  });

  return res.json(result);
});

/**
 * POST /api/admin/product-requests/:id/review
 *
 * Request body:
 * {
 *   "decision": "APPROVED",
 *   "adminNotes": "Good margin, adding to catalog",
 *   "catalogProductId": "clxxx"   // required if APPROVED
 * }
 *
 * Response: { request: ProductRequest }
 */
router.post(
  "/:id/review",
  requireRole("SUPER_ADMIN", "ADMIN"),
  async (req: Request, res: Response) => {
    const { adminUser } = req as AuthRequest;
    const { decision, adminNotes, catalogProductId } = req.body;

    if (!["APPROVED", "REJECTED"].includes(decision)) {
      return res.status(400).json({ error: "Decision must be APPROVED or REJECTED" });
    }

    if (decision === "APPROVED" && !catalogProductId) {
      return res.status(400).json({
        error: "catalogProductId required when approving. Create the catalog product first.",
      });
    }

    try {
      const request = await reviewProductRequest(
        req.params.id,
        decision,
        adminUser.userId,
        adminNotes,
        catalogProductId,
      );
      return res.json({ request });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Review failed",
      });
    }
  },
);

export default router;
