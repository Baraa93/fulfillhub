import { prisma } from "~/db.server";
import { logAudit } from "./audit.server";

// ─────────────────────────────────────────────
// Import catalog product into seller's Shopify store
// ─────────────────────────────────────────────

export async function importProductToShopify(
  sellerId: string,
  catalogProductId: string,
  sellerPrice?: number,
) {
  const seller = await prisma.seller.findUniqueOrThrow({
    where: { id: sellerId },
  });

  const catalogProduct = await prisma.catalogProduct.findUniqueOrThrow({
    where: { id: catalogProductId },
    include: { variants: { where: { status: "ACTIVE" } } },
  });

  if (catalogProduct.status !== "ACTIVE") {
    throw new Error("Product is not active in catalog");
  }

  // Check if already imported
  const existing = await prisma.sellerProduct.findFirst({
    where: { sellerId, catalogProductId },
  });
  if (existing) {
    throw new Error("Product already imported to your store");
  }

  const shop = seller.shopDomain;
  const accessToken = seller.accessToken;
  const apiVersion = "2024-01";

  // Build Shopify product payload
  const price =
    sellerPrice || Number(catalogProduct.suggestedPriceUsd);

  const shopifyPayload = {
    product: {
      title: catalogProduct.title,
      body_html: catalogProduct.bodyHtml || catalogProduct.description || "",
      vendor: "FulfillHub",
      product_type: catalogProduct.productType || catalogProduct.category || "",
      tags: ["fulfillhub", "imported", ...(catalogProduct.tags || [])].join(
        ", ",
      ),
      variants:
        catalogProduct.variants.length > 0
          ? catalogProduct.variants.map((v) => ({
              title: v.title,
              sku: v.sku,
              price: sellerPrice?.toString() || Number(v.priceUsd).toString(),
              inventory_management: null, // we manage inventory, not Shopify
              requires_shipping: true,
              weight: v.weightKg ? Number(v.weightKg) : undefined,
              weight_unit: "kg",
              option1: v.option1 || undefined,
              option2: v.option2 || undefined,
              option3: v.option3 || undefined,
            }))
          : [
              {
                title: "Default",
                sku: catalogProduct.sku,
                price: price.toString(),
                inventory_management: null,
                requires_shipping: true,
                weight: catalogProduct.weightKg
                  ? Number(catalogProduct.weightKg)
                  : undefined,
                weight_unit: "kg",
              },
            ],
      images: catalogProduct.images.map((src) => ({ src })),
    },
  };

  // Create product in Shopify
  const response = await fetch(
    `https://${shop}/admin/api/${apiVersion}/products.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(shopifyPayload),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to create Shopify product: ${response.status} ${errorText}`,
    );
  }

  const data = await response.json();
  const shopifyProduct = data.product;

  // Store seller product mappings (one per variant)
  const sellerProducts = await Promise.all(
    shopifyProduct.variants.map(
      async (
        sv: { id: number; sku: string; price: string },
        index: number,
      ) => {
        const catalogVariant = catalogProduct.variants[index] || null;

        return prisma.sellerProduct.create({
          data: {
            sellerId,
            catalogProductId: catalogProduct.id,
            catalogVariantId: catalogVariant?.id || null,
            shopifyProductId: String(shopifyProduct.id),
            shopifyVariantId: String(sv.id),
            sellerPrice: Number(sv.price),
            status: "ACTIVE",
          },
        });
      },
    ),
  );

  await logAudit({
    actorType: "SELLER",
    actorId: sellerId,
    action: "product.imported",
    entityType: "SellerProduct",
    entityId: sellerProducts[0]?.id || catalogProductId,
    sellerId,
    details: {
      catalogProductId,
      shopifyProductId: shopifyProduct.id,
      variantCount: shopifyProduct.variants.length,
    },
  });

  return {
    shopifyProductId: shopifyProduct.id,
    sellerProducts,
  };
}

// ─────────────────────────────────────────────
// Get seller's imported products
// ─────────────────────────────────────────────

export async function getSellerProducts(
  sellerId: string,
  options?: { page?: number; limit?: number },
) {
  const page = options?.page || 1;
  const limit = options?.limit || 20;

  const [products, total] = await Promise.all([
    prisma.sellerProduct.findMany({
      where: { sellerId },
      include: {
        catalogProduct: true,
        catalogVariant: true,
      },
      orderBy: { importedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.sellerProduct.count({ where: { sellerId } }),
  ]);

  return { products, total, page, limit, totalPages: Math.ceil(total / limit) };
}
