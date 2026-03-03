import { Router, type Request, type Response } from "express";
import type { AdminTokenPayload } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { createShipment, getOrderShipments } from "../../app/services/shipping.server";
import {
  pushTrackingToShopify,
  updateShopifyTracking,
} from "../../app/services/shopify-fulfillment.server";
import { prisma } from "../../app/db.server";

const router = Router();

type AuthRequest = Request & { adminUser: AdminTokenPayload };

/**
 * POST /api/admin/shipping/create
 *
 * Create a shipment via carrier API or manual entry.
 *
 * Request body:
 * {
 *   "orderId": "clxxx",
 *   "carrier": "ARAMEX",              // optional override
 *   "manualTrackingNumber": "AWB123"   // if manual entry
 * }
 *
 * Response:
 * {
 *   "shipment": {
 *     "id": "clyyy",
 *     "orderId": "clxxx",
 *     "carrier": "ARAMEX",
 *     "trackingNumber": "AWB123456789",
 *     "status": "LABEL_CREATED",
 *     "createdVia": "API",
 *     ...
 *   }
 * }
 */
router.post(
  "/create",
  requireRole("SUPER_ADMIN", "ADMIN", "WAREHOUSE"),
  async (req: Request, res: Response) => {
    const { adminUser } = req as AuthRequest;
    const { orderId, carrier, manualTrackingNumber } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: "orderId is required" });
    }

    try {
      const shipment = await createShipment({
        orderId,
        carrier,
        manualTrackingNumber,
        adminUserId: adminUser.userId,
      });
      return res.status(201).json({ shipment });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to create shipment",
      });
    }
  },
);

/**
 * POST /api/admin/shipping/:shipmentId/push-tracking
 *
 * Push tracking info to Shopify (create fulfillment).
 *
 * Response:
 * {
 *   "fulfillmentId": "12345",
 *   "trackingUrl": "https://www.aramex.com/track/..."
 * }
 */
router.post(
  "/:shipmentId/push-tracking",
  requireRole("SUPER_ADMIN", "ADMIN"),
  async (req: Request, res: Response) => {
    const { adminUser } = req as AuthRequest;

    try {
      const result = await pushTrackingToShopify(
        req.params.shipmentId,
        adminUser.userId,
      );
      return res.json(result);
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to push tracking",
      });
    }
  },
);

/**
 * PUT /api/admin/shipping/:shipmentId/tracking
 *
 * Update tracking number on an existing shipment + update Shopify.
 *
 * Request body:
 * {
 *   "trackingNumber": "NEW_AWB_123",
 *   "carrier": "SMSA"
 * }
 */
router.put(
  "/:shipmentId/tracking",
  requireRole("SUPER_ADMIN", "ADMIN"),
  async (req: Request, res: Response) => {
    const { trackingNumber, carrier } = req.body;

    if (!trackingNumber || !carrier) {
      return res.status(400).json({ error: "trackingNumber and carrier required" });
    }

    try {
      await updateShopifyTracking(req.params.shipmentId, trackingNumber, carrier);
      return res.json({ success: true });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to update tracking",
      });
    }
  },
);

/**
 * GET /api/admin/shipping/ready
 *
 * Get orders ready to ship (status: PACKED).
 */
router.get("/ready", async (_req: Request, res: Response) => {
  const orders = await prisma.order.findMany({
    where: { status: "PACKED" },
    include: {
      seller: { select: { shopName: true } },
      lineItems: true,
    },
    orderBy: { packedAt: "asc" },
  });

  return res.json({ orders });
});

/**
 * GET /api/admin/shipping/order/:orderId
 *
 * Get all shipments for an order.
 */
router.get("/order/:orderId", async (req: Request, res: Response) => {
  const shipments = await getOrderShipments(req.params.orderId);
  return res.json({ shipments });
});

export default router;
