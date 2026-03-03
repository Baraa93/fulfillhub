import { Prisma } from "@prisma/client";
import { prisma } from "~/db.server";
import { logAudit } from "./audit.server";

type TransactionClient = Parameters<
  Parameters<typeof prisma.$transaction>[0]
>[0];

// ─────────────────────────────────────────────
// Deduct from seller wallet (used inside transactions)
// ─────────────────────────────────────────────

export async function deductWallet(
  tx: TransactionClient,
  sellerId: string,
  amount: number,
  description: string,
  referenceType?: string,
  referenceId?: string,
) {
  // Lock the seller row to prevent race conditions
  const seller = await tx.seller.findUniqueOrThrow({
    where: { id: sellerId },
  });

  const currentBalance = Number(seller.walletBalance);
  if (currentBalance < amount) {
    throw new Error(
      `Insufficient wallet balance. Current: ${currentBalance}, Required: ${amount}`,
    );
  }

  const newBalance = currentBalance - amount;

  await tx.seller.update({
    where: { id: sellerId },
    data: { walletBalance: new Prisma.Decimal(newBalance) },
  });

  await tx.walletTransaction.create({
    data: {
      sellerId,
      type: "DEBIT",
      amount: new Prisma.Decimal(-amount),
      balanceAfter: new Prisma.Decimal(newBalance),
      description,
      referenceType,
      referenceId,
    },
  });

  return newBalance;
}

// ─────────────────────────────────────────────
// Credit seller wallet (top-up, refund)
// ─────────────────────────────────────────────

export async function creditWallet(
  sellerId: string,
  amount: number,
  description: string,
  referenceType: string,
  referenceId?: string,
  createdBy?: string,
) {
  const result = await prisma.$transaction(async (tx) => {
    const seller = await tx.seller.findUniqueOrThrow({
      where: { id: sellerId },
    });

    const newBalance = Number(seller.walletBalance) + amount;

    await tx.seller.update({
      where: { id: sellerId },
      data: { walletBalance: new Prisma.Decimal(newBalance) },
    });

    const txn = await tx.walletTransaction.create({
      data: {
        sellerId,
        type: "CREDIT",
        amount: new Prisma.Decimal(amount),
        balanceAfter: new Prisma.Decimal(newBalance),
        description,
        referenceType,
        referenceId,
        createdBy,
      },
    });

    return { newBalance, transaction: txn };
  });

  await logAudit({
    actorType: createdBy ? "ADMIN" : "SYSTEM",
    actorId: createdBy,
    action: "wallet.credited",
    entityType: "Seller",
    entityId: sellerId,
    sellerId,
    details: { amount, description, referenceType, newBalance: result.newBalance },
  });

  return result;
}

// ─────────────────────────────────────────────
// Admin manual wallet adjustment
// ─────────────────────────────────────────────

export async function adjustWallet(
  sellerId: string,
  amount: number, // positive = credit, negative = debit
  reason: string,
  adminUserId: string,
) {
  const result = await prisma.$transaction(async (tx) => {
    const seller = await tx.seller.findUniqueOrThrow({
      where: { id: sellerId },
    });

    const newBalance = Number(seller.walletBalance) + amount;
    if (newBalance < 0) {
      throw new Error(
        `Adjustment would result in negative balance: ${newBalance}`,
      );
    }

    await tx.seller.update({
      where: { id: sellerId },
      data: { walletBalance: new Prisma.Decimal(newBalance) },
    });

    const txn = await tx.walletTransaction.create({
      data: {
        sellerId,
        type: "ADJUSTMENT",
        amount: new Prisma.Decimal(amount),
        balanceAfter: new Prisma.Decimal(newBalance),
        description: `Admin adjustment: ${reason}`,
        referenceType: "adjustment",
        createdBy: adminUserId,
      },
    });

    return { newBalance, transaction: txn };
  });

  await logAudit({
    actorType: "ADMIN",
    actorId: adminUserId,
    action: "wallet.adjusted",
    entityType: "Seller",
    entityId: sellerId,
    sellerId,
    details: { amount, reason, newBalance: result.newBalance },
  });

  return result;
}

// ─────────────────────────────────────────────
// Get wallet transactions for a seller
// ─────────────────────────────────────────────

export async function getWalletTransactions(
  sellerId: string,
  options?: { page?: number; limit?: number },
) {
  const page = options?.page || 1;
  const limit = options?.limit || 20;

  const [transactions, total] = await Promise.all([
    prisma.walletTransaction.findMany({
      where: { sellerId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.walletTransaction.count({ where: { sellerId } }),
  ]);

  return { transactions, total, page, limit, totalPages: Math.ceil(total / limit) };
}
