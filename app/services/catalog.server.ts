import { prisma } from "~/db.server";
import type { CatalogProductStatus, Prisma } from "@prisma/client";
import { logAudit } from "./audit.server";

// ─────────────────────────────────────────────
// Catalog Product CRUD (Admin)
// ─────────────────────────────────────────────

export interface CreateCatalogProductInput {
  sku: string;
  title: string;
  description?: string;
  bodyHtml?: string;
  category?: string;
  tags?: string[];
  images?: string[];
  vendor?: string;
  productType?: string;
  sourceUrl?: string;
  supplierName?: string;
  supplierCost: number;
  costCurrency?: string;
  weightKg?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  eligibleCountries?: string[];
  customsRiskFlag?: "LOW" | "MEDIUM" | "HIGH";
  stockType?: "IN_WAREHOUSE" | "ON_DEMAND";
  stockQuantity?: number;
  leadTimeDays?: number;
  suggestedPriceUsd: number;
  minSellerPriceUsd?: number;
  variants?: CreateVariantInput[];
}

export interface CreateVariantInput {
  sku: string;
  title: string;
  option1?: string;
  option2?: string;
  option3?: string;
  priceUsd: number;
  costTry?: number;
  weightKg?: number;
  barcode?: string;
  stockQuantity?: number;
}

export async function createCatalogProduct(
  input: CreateCatalogProductInput,
  adminUserId: string,
) {
  // Calculate overall score if component scores are provided
  const product = await prisma.catalogProduct.create({
    data: {
      sku: input.sku,
      title: input.title,
      description: input.description,
      bodyHtml: input.bodyHtml,
      category: input.category,
      tags: input.tags || [],
      images: input.images || [],
      vendor: input.vendor,
      productType: input.productType,
      sourceUrl: input.sourceUrl,
      supplierName: input.supplierName,
      supplierCost: input.supplierCost,
      costCurrency: input.costCurrency || "TRY",
      weightKg: input.weightKg,
      lengthCm: input.lengthCm,
      widthCm: input.widthCm,
      heightCm: input.heightCm,
      eligibleCountries: input.eligibleCountries || [
        "AE",
        "SA",
        "KW",
        "QA",
        "OM",
        "BH",
      ],
      customsRiskFlag: input.customsRiskFlag || "LOW",
      stockType: input.stockType || "ON_DEMAND",
      stockQuantity: input.stockQuantity || 0,
      leadTimeDays: input.leadTimeDays || 5,
      suggestedPriceUsd: input.suggestedPriceUsd,
      minSellerPriceUsd: input.minSellerPriceUsd,
      status: "DRAFT",
      variants: input.variants
        ? {
            create: input.variants.map((v) => ({
              sku: v.sku,
              title: v.title,
              option1: v.option1,
              option2: v.option2,
              option3: v.option3,
              priceUsd: v.priceUsd,
              costTry: v.costTry,
              weightKg: v.weightKg,
              barcode: v.barcode,
              stockQuantity: v.stockQuantity || 0,
              status: "DRAFT" as const,
            })),
          }
        : undefined,
    },
    include: { variants: true },
  });

  await logAudit({
    actorType: "ADMIN",
    actorId: adminUserId,
    action: "catalog.product_created",
    entityType: "CatalogProduct",
    entityId: product.id,
    details: { sku: input.sku, title: input.title },
  });

  return product;
}

export async function updateCatalogProduct(
  productId: string,
  input: Partial<CreateCatalogProductInput>,
  adminUserId: string,
) {
  const data: Prisma.CatalogProductUpdateInput = {};

  // Only set fields that are provided
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.bodyHtml !== undefined) data.bodyHtml = input.bodyHtml;
  if (input.category !== undefined) data.category = input.category;
  if (input.tags !== undefined) data.tags = input.tags;
  if (input.images !== undefined) data.images = input.images;
  if (input.vendor !== undefined) data.vendor = input.vendor;
  if (input.productType !== undefined) data.productType = input.productType;
  if (input.sourceUrl !== undefined) data.sourceUrl = input.sourceUrl;
  if (input.supplierName !== undefined) data.supplierName = input.supplierName;
  if (input.supplierCost !== undefined) data.supplierCost = input.supplierCost;
  if (input.weightKg !== undefined) data.weightKg = input.weightKg;
  if (input.eligibleCountries !== undefined)
    data.eligibleCountries = input.eligibleCountries;
  if (input.customsRiskFlag !== undefined)
    data.customsRiskFlag = input.customsRiskFlag;
  if (input.stockType !== undefined) data.stockType = input.stockType;
  if (input.stockQuantity !== undefined)
    data.stockQuantity = input.stockQuantity;
  if (input.suggestedPriceUsd !== undefined)
    data.suggestedPriceUsd = input.suggestedPriceUsd;
  if (input.minSellerPriceUsd !== undefined)
    data.minSellerPriceUsd = input.minSellerPriceUsd;

  const product = await prisma.catalogProduct.update({
    where: { id: productId },
    data,
    include: { variants: true },
  });

  await logAudit({
    actorType: "ADMIN",
    actorId: adminUserId,
    action: "catalog.product_updated",
    entityType: "CatalogProduct",
    entityId: productId,
    details: { updatedFields: Object.keys(data) },
  });

  return product;
}

// ─────────────────────────────────────────────
// Calculate and store product score
// ─────────────────────────────────────────────

export async function scoreProduct(
  productId: string,
  scores: {
    demandScore: number; // 1-5
    marginScore: number;
    shippingScore: number;
    customsScore: number;
    returnScore: number;
  },
  adminUserId: string,
) {
  // Weighted average: demand 25%, margin 25%, shipping 20%, customs 15%, return 15%
  const overallScore =
    scores.demandScore * 0.25 +
    scores.marginScore * 0.25 +
    scores.shippingScore * 0.2 +
    scores.customsScore * 0.15 +
    scores.returnScore * 0.15;

  const product = await prisma.catalogProduct.update({
    where: { id: productId },
    data: {
      demandScore: scores.demandScore,
      marginScore: scores.marginScore,
      shippingScore: scores.shippingScore,
      customsScore: scores.customsScore,
      returnScore: scores.returnScore,
      overallScore: Math.round(overallScore * 100) / 100,
    },
  });

  await logAudit({
    actorType: "ADMIN",
    actorId: adminUserId,
    action: "catalog.product_scored",
    entityType: "CatalogProduct",
    entityId: productId,
    details: { scores, overallScore },
  });

  return product;
}

// ─────────────────────────────────────────────
// Catalog browsing (seller-facing)
// ─────────────────────────────────────────────

export async function browseCatalog(options?: {
  category?: string;
  country?: string; // filter by eligible country
  search?: string;
  page?: number;
  limit?: number;
}) {
  const page = options?.page || 1;
  const limit = options?.limit || 20;

  const where: Prisma.CatalogProductWhereInput = {
    status: "ACTIVE",
  };

  if (options?.category) where.category = options.category;
  if (options?.country) where.eligibleCountries = { has: options.country };
  if (options?.search) {
    where.OR = [
      { title: { contains: options.search, mode: "insensitive" } },
      { sku: { contains: options.search, mode: "insensitive" } },
      { tags: { has: options.search } },
    ];
  }

  const [products, total] = await Promise.all([
    prisma.catalogProduct.findMany({
      where,
      include: { variants: { where: { status: "ACTIVE" } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.catalogProduct.count({ where }),
  ]);

  return { products, total, page, limit, totalPages: Math.ceil(total / limit) };
}

// ─────────────────────────────────────────────
// Admin catalog list (includes all statuses)
// ─────────────────────────────────────────────

export async function getAdminCatalog(options?: {
  status?: CatalogProductStatus;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const page = options?.page || 1;
  const limit = options?.limit || 50;

  const where: Prisma.CatalogProductWhereInput = {};
  if (options?.status) where.status = options.status;
  if (options?.search) {
    where.OR = [
      { title: { contains: options.search, mode: "insensitive" } },
      { sku: { contains: options.search, mode: "insensitive" } },
    ];
  }

  const [products, total] = await Promise.all([
    prisma.catalogProduct.findMany({
      where,
      include: { variants: true },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.catalogProduct.count({ where }),
  ]);

  return { products, total, page, limit, totalPages: Math.ceil(total / limit) };
}
