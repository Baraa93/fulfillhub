import { Router, type Request, type Response } from "express";
import type { AdminTokenPayload } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import {
  createCatalogProduct,
  updateCatalogProduct,
  scoreProduct,
  getAdminCatalog,
} from "../../app/services/catalog.server";
import { prisma } from "../../app/db.server";

const router = Router();

type AuthRequest = Request & { adminUser: AdminTokenPayload };

/**
 * GET /api/admin/catalog
 * Query: ?status=ACTIVE&search=towel&page=1&limit=50
 *
 * Response:
 * {
 *   products: [...],
 *   total: 120,
 *   page: 1,
 *   limit: 50,
 *   totalPages: 3
 * }
 */
router.get("/", async (req: Request, res: Response) => {
  const { status, search, page, limit } = req.query;

  const result = await getAdminCatalog({
    status: status as "DRAFT" | "ACTIVE" | "INACTIVE" | undefined,
    search: search as string | undefined,
    page: page ? Number(page) : undefined,
    limit: limit ? Number(limit) : undefined,
  });

  return res.json(result);
});

/**
 * GET /api/admin/catalog/:id
 *
 * Response: { product: CatalogProduct with variants }
 */
router.get("/:id", async (req: Request, res: Response) => {
  const product = await prisma.catalogProduct.findUnique({
    where: { id: req.params.id },
    include: { variants: true },
  });

  if (!product) {
    return res.status(404).json({ error: "Product not found" });
  }

  return res.json({ product });
});

/**
 * POST /api/admin/catalog
 *
 * Request body: CreateCatalogProductInput
 *
 * Example:
 * {
 *   "sku": "FH-TWL-001",
 *   "title": "Turkish Cotton Towel Set",
 *   "description": "Premium cotton towel set from Denizli",
 *   "category": "Home & Living",
 *   "supplierCost": 150,
 *   "costCurrency": "TRY",
 *   "suggestedPriceUsd": 29.99,
 *   "weightKg": 0.8,
 *   "eligibleCountries": ["AE", "SA", "KW", "QA", "OM", "BH"],
 *   "customsRiskFlag": "LOW",
 *   "stockType": "ON_DEMAND",
 *   "variants": [
 *     {
 *       "sku": "FH-TWL-001-WH-L",
 *       "title": "White / Large",
 *       "option1": "White",
 *       "option2": "Large",
 *       "priceUsd": 29.99,
 *       "costTry": 150
 *     },
 *     {
 *       "sku": "FH-TWL-001-BG-L",
 *       "title": "Beige / Large",
 *       "option1": "Beige",
 *       "option2": "Large",
 *       "priceUsd": 29.99,
 *       "costTry": 150
 *     }
 *   ]
 * }
 *
 * Response: { product: CatalogProduct with variants }
 */
router.post(
  "/",
  requireRole("SUPER_ADMIN", "ADMIN"),
  async (req: Request, res: Response) => {
    const { adminUser } = req as AuthRequest;

    try {
      const product = await createCatalogProduct(req.body, adminUser.userId);
      return res.status(201).json({ product });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to create product",
      });
    }
  },
);

/**
 * PUT /api/admin/catalog/:id
 *
 * Request body: Partial<CreateCatalogProductInput>
 * Response: { product: CatalogProduct with variants }
 */
router.put(
  "/:id",
  requireRole("SUPER_ADMIN", "ADMIN"),
  async (req: Request, res: Response) => {
    const { adminUser } = req as AuthRequest;

    try {
      const product = await updateCatalogProduct(
        req.params.id,
        req.body,
        adminUser.userId,
      );
      return res.json({ product });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to update product",
      });
    }
  },
);

/**
 * POST /api/admin/catalog/:id/score
 *
 * Request body:
 * {
 *   "demandScore": 4,
 *   "marginScore": 3,
 *   "shippingScore": 5,
 *   "customsScore": 4,
 *   "returnScore": 4
 * }
 *
 * Response: { product: CatalogProduct, overallScore: 3.95 }
 */
router.post(
  "/:id/score",
  requireRole("SUPER_ADMIN", "ADMIN"),
  async (req: Request, res: Response) => {
    const { adminUser } = req as AuthRequest;
    const { demandScore, marginScore, shippingScore, customsScore, returnScore } =
      req.body;

    try {
      const product = await scoreProduct(
        req.params.id,
        { demandScore, marginScore, shippingScore, customsScore, returnScore },
        adminUser.userId,
      );
      return res.json({ product, overallScore: product.overallScore });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to score product",
      });
    }
  },
);

/**
 * PATCH /api/admin/catalog/:id/status
 *
 * Request body: { "status": "ACTIVE" }
 * Response: { product: CatalogProduct }
 */
router.patch(
  "/:id/status",
  requireRole("SUPER_ADMIN", "ADMIN"),
  async (req: Request, res: Response) => {
    const { status } = req.body;
    if (!["DRAFT", "ACTIVE", "INACTIVE"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const product = await prisma.catalogProduct.update({
      where: { id: req.params.id },
      data: { status },
    });

    return res.json({ product });
  },
);

export default router;
