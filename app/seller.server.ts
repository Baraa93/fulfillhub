import { prisma } from "./db.server";
import type { Session } from "@shopify/shopify-api";

/**
 * Given a Shopify admin session, returns the Seller record.
 * Creates one automatically on first access (app install).
 */
export async function getOrCreateSeller(session: Session) {
  const shopDomain = session.shop;

  let seller = await prisma.seller.findUnique({
    where: { shopDomain },
  });

  if (!seller) {
    seller = await prisma.seller.create({
      data: {
        shopDomain,
        accessToken: session.accessToken || "",
        shopName: shopDomain.replace(".myshopify.com", ""),
      },
    });
  } else if (session.accessToken && seller.accessToken !== session.accessToken) {
    // Update access token if it changed (e.g. re-install)
    seller = await prisma.seller.update({
      where: { id: seller.id },
      data: { accessToken: session.accessToken },
    });
  }

  return seller;
}
