import { prisma } from "~/db.server";
import type { ProductRequestStatus, Prisma } from "@prisma/client";
import { logAudit } from "./audit.server";

// ─────────────────────────────────────────────
// Seller: Submit product request
// ─────────────────────────────────────────────

export async function submitProductRequest(
  sellerId: string,
  trendyolUrl: string,
  notes?: string,
  desiredCategory?: string,
) {
  // Basic URL validation
  if (
    !trendyolUrl.includes("trendyol.com") &&
    !trendyolUrl.includes("ty.com")
  ) {
    throw new Error("Please provide a valid Trendyol product URL");
  }

  const request = await prisma.productRequest.create({
    data: {
      sellerId,
      trendyolUrl,
      notes,
      desiredCategory,
      status: "PENDING",
    },
  });

  await logAudit({
    actorType: "SELLER",
    actorId: sellerId,
    action: "product_request.submitted",
    entityType: "ProductRequest",
    entityId: request.id,
    sellerId,
    details: { trendyolUrl, desiredCategory },
  });

  return request;
}

// ─────────────────────────────────────────────
// Admin: Review product request
// ─────────────────────────────────────────────

export async function reviewProductRequest(
  requestId: string,
  decision: "APPROVED" | "REJECTED",
  adminUserId: string,
  adminNotes?: string,
  catalogProductId?: string, // if approved, link to the new catalog product
) {
  const request = await prisma.productRequest.update({
    where: { id: requestId },
    data: {
      status: decision,
      adminNotes,
      reviewedBy: adminUserId,
      reviewedAt: new Date(),
      catalogProductId: decision === "APPROVED" ? catalogProductId : null,
    },
  });

  await logAudit({
    actorType: "ADMIN",
    actorId: adminUserId,
    action: `product_request.${decision.toLowerCase()}`,
    entityType: "ProductRequest",
    entityId: requestId,
    sellerId: request.sellerId,
    details: { decision, adminNotes, catalogProductId },
  });

  return request;
}

// ─────────────────────────────────────────────
// Seller: Get my requests
// ─────────────────────────────────────────────

export async function getSellerProductRequests(
  sellerId: string,
  options?: { status?: ProductRequestStatus; page?: number; limit?: number },
) {
  const page = options?.page || 1;
  const limit = options?.limit || 20;

  const where: Prisma.ProductRequestWhereInput = { sellerId };
  if (options?.status) where.status = options.status;

  const [requests, total] = await Promise.all([
    prisma.productRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.productRequest.count({ where }),
  ]);

  return { requests, total, page, limit, totalPages: Math.ceil(total / limit) };
}

// ─────────────────────────────────────────────
// Admin: Get all requests
// ─────────────────────────────────────────────

export async function getAdminProductRequests(options?: {
  status?: ProductRequestStatus;
  page?: number;
  limit?: number;
}) {
  const page = options?.page || 1;
  const limit = options?.limit || 50;

  const where: Prisma.ProductRequestWhereInput = {};
  if (options?.status) where.status = options.status;

  const [requests, total] = await Promise.all([
    prisma.productRequest.findMany({
      where,
      include: {
        seller: { select: { shopName: true, shopDomain: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.productRequest.count({ where }),
  ]);

  return { requests, total, page, limit, totalPages: Math.ceil(total / limit) };
}
