import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Create default admin user
  const passwordHash = await bcrypt.hash("admin123", 12);
  const admin = await prisma.adminUser.upsert({
    where: { email: "admin@fulfillhub.com" },
    update: {},
    create: {
      email: "admin@fulfillhub.com",
      passwordHash,
      name: "Admin",
      role: "SUPER_ADMIN",
    },
  });
  console.log(`Admin user created: ${admin.email}`);

  // Create default shipping rules for GCC countries
  const shippingRules = [
    { country: "SA", defaultCarrier: "SMSA" as const, baseCostUsd: 8, perKgCostUsd: 2, estimatedDays: 5 },
    { country: "AE", defaultCarrier: "ARAMEX" as const, baseCostUsd: 10, perKgCostUsd: 3, estimatedDays: 4 },
    { country: "KW", defaultCarrier: "ARAMEX" as const, baseCostUsd: 12, perKgCostUsd: 3.5, estimatedDays: 5 },
    { country: "QA", defaultCarrier: "ARAMEX" as const, baseCostUsd: 12, perKgCostUsd: 3.5, estimatedDays: 5 },
    { country: "OM", defaultCarrier: "ARAMEX" as const, baseCostUsd: 12, perKgCostUsd: 3.5, estimatedDays: 6 },
    { country: "BH", defaultCarrier: "ARAMEX" as const, baseCostUsd: 11, perKgCostUsd: 3, estimatedDays: 5 },
  ];

  for (const rule of shippingRules) {
    await prisma.shippingRule.upsert({
      where: { country: rule.country },
      update: rule,
      create: rule,
    });
  }
  console.log(`Shipping rules created for ${shippingRules.length} countries`);

  // Create sample catalog products
  const sampleProduct = await prisma.catalogProduct.upsert({
    where: { sku: "FH-TWL-001" },
    update: {},
    create: {
      sku: "FH-TWL-001",
      title: "Premium Turkish Cotton Towel Set",
      description: "Luxurious 100% Turkish cotton towel set from Denizli. Includes bath towel, hand towel, and face towel.",
      bodyHtml: "<p>Luxurious 100% Turkish cotton towel set from Denizli.</p><ul><li>Bath towel (70x140cm)</li><li>Hand towel (50x90cm)</li><li>Face towel (30x50cm)</li></ul>",
      category: "Home & Living",
      tags: ["towel", "cotton", "turkish", "bathroom"],
      images: [],
      vendor: "Denizli Tekstil",
      productType: "Home & Living",
      status: "ACTIVE",
      sourceUrl: "https://www.trendyol.com/example-towel-set",
      supplierName: "Denizli Tekstil A.Ş.",
      supplierCost: 150,
      costCurrency: "TRY",
      weightKg: 0.8,
      lengthCm: 30,
      widthCm: 25,
      heightCm: 10,
      eligibleCountries: ["AE", "SA", "KW", "QA", "OM", "BH"],
      customsRiskFlag: "LOW",
      stockType: "ON_DEMAND",
      leadTimeDays: 5,
      suggestedPriceUsd: 29.99,
      minSellerPriceUsd: 24.99,
      demandScore: 4,
      marginScore: 4,
      shippingScore: 5,
      customsScore: 5,
      returnScore: 4,
      overallScore: 4.3,
      variants: {
        create: [
          {
            sku: "FH-TWL-001-WH-STD",
            title: "White / Standard",
            option1: "White",
            option2: "Standard",
            priceUsd: 29.99,
            costTry: 150,
            weightKg: 0.8,
            stockQuantity: 50,
            status: "ACTIVE",
          },
          {
            sku: "FH-TWL-001-BG-STD",
            title: "Beige / Standard",
            option1: "Beige",
            option2: "Standard",
            priceUsd: 29.99,
            costTry: 150,
            weightKg: 0.8,
            stockQuantity: 30,
            status: "ACTIVE",
          },
          {
            sku: "FH-TWL-001-GR-STD",
            title: "Grey / Standard",
            option1: "Grey",
            option2: "Standard",
            priceUsd: 29.99,
            costTry: 150,
            weightKg: 0.8,
            stockQuantity: 20,
            status: "ACTIVE",
          },
        ],
      },
    },
  });
  console.log(`Sample catalog product created: ${sampleProduct.sku}`);

  console.log("Seeding complete.");
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
