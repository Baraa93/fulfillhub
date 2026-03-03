import { PrismaClient } from "@prisma/client";

let prisma: PrismaClient;

declare global {
  // eslint-disable-next-line no-var
  var __db__: PrismaClient | undefined;
}

// Singleton pattern — avoid multiple clients in dev (Remix hot reload)
if (process.env.NODE_ENV === "production") {
  prisma = new PrismaClient();
} else {
  if (!global.__db__) {
    global.__db__ = new PrismaClient({
      log: ["query", "warn", "error"],
    });
  }
  prisma = global.__db__;
}

export { prisma };
