import { prisma } from "~/db.server";
import type { ActorType, Prisma } from "@prisma/client";

interface AuditLogParams {
  actorType: ActorType;
  actorId?: string;
  action: string;
  entityType: string;
  entityId: string;
  sellerId?: string;
  orderId?: string;
  details?: Record<string, unknown>;
}

export async function logAudit(params: AuditLogParams) {
  try {
    await prisma.auditLog.create({
      data: {
        actorType: params.actorType,
        actorId: params.actorId || null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        sellerId: params.sellerId || null,
        orderId: params.orderId || null,
        details: (params.details as Prisma.InputJsonValue) || undefined,
      },
    });
  } catch (error) {
    // Audit logging should never break the main flow
    console.error("Failed to write audit log:", error, params);
  }
}
