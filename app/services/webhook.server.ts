import { prisma } from "~/db.server";
import type { Prisma } from "@prisma/client";

/**
 * Idempotent webhook processing.
 * Returns true if this webhook should be processed (first time seen).
 * Returns false if duplicate (already processed).
 */
export async function shouldProcessWebhook(
  webhookId: string,
  topic: string,
  shopDomain: string,
  payload?: unknown,
): Promise<boolean> {
  try {
    await prisma.webhookLog.create({
      data: {
        shopifyWebhookId: webhookId,
        topic,
        shopDomain,
        payload: payload as Prisma.InputJsonValue,
        status: "PROCESSED",
      },
    });
    return true;
  } catch (error: unknown) {
    // Unique constraint violation = duplicate
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      console.log(`Duplicate webhook skipped: ${webhookId} (${topic})`);
      return false;
    }
    throw error;
  }
}

export async function markWebhookFailed(
  webhookId: string,
  errorMessage: string,
): Promise<void> {
  await prisma.webhookLog.update({
    where: { shopifyWebhookId: webhookId },
    data: { status: "FAILED", errorMessage },
  });
}
