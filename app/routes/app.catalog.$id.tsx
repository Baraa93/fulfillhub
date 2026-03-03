import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  DataTable,
  Banner,
  Thumbnail,
} from "@shopify/polaris";
import { prisma } from "~/db.server";
import { importProductToShopify } from "~/services/shopify-product.server";

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const product = await prisma.catalogProduct.findUnique({
    where: { id: params.id },
    include: { variants: { where: { status: "ACTIVE" } } },
  });

  if (!product) {
    throw new Response("Product not found", { status: 404 });
  }

  return json({ product });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "import") {
    // TODO: Get sellerId from Shopify session
    // const { session } = await authenticate.admin(request);
    // const seller = await prisma.seller.findUnique({ where: { shopDomain: session.shop } });
    const sellerId = formData.get("sellerId") as string;

    try {
      const result = await importProductToShopify(sellerId, params.id!);
      return json({ success: true, shopifyProductId: result.shopifyProductId });
    } catch (error) {
      return json(
        { success: false, error: error instanceof Error ? error.message : "Import failed" },
        { status: 400 },
      );
    }
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

export default function CatalogProductDetail() {
  const { product } = useLoaderData<typeof loader>();
  const submit = useSubmit();

  const handleImport = () => {
    const formData = new FormData();
    formData.set("intent", "import");
    // In production, sellerId comes from session — not from form
    formData.set("sellerId", "TODO_FROM_SESSION");
    submit(formData, { method: "post" });
  };

  const variantRows = (product.variants as any[]).map((v) => [
    v.sku,
    v.title,
    `$${Number(v.priceUsd).toFixed(2)}`,
    v.stockQuantity,
    v.weightKg ? `${Number(v.weightKg)} kg` : "—",
  ]);

  return (
    <Page
      title={product.title}
      subtitle={`SKU: ${product.sku}`}
      backAction={{ url: "/app/catalog" }}
      primaryAction={{
        content: "Import to My Store",
        onAction: handleImport,
      }}
    >
      <Layout>
        <Layout.Section>
          {(product.images as string[])?.length > 0 && (
            <Card>
              <InlineStack gap="300">
                {(product.images as string[]).map((img, i) => (
                  <Thumbnail key={i} source={img} alt={product.title} size="large" />
                ))}
              </InlineStack>
            </Card>
          )}

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Product Details</Text>
              {product.description && (
                <Text as="p" variant="bodyMd">{product.description}</Text>
              )}
              <InlineStack gap="200">
                {product.category && <Badge>{product.category}</Badge>}
                <Badge tone={product.stockType === "IN_WAREHOUSE" ? "success" : "info"}>
                  {product.stockType === "IN_WAREHOUSE" ? "In Stock" : `On Demand (${product.leadTimeDays}d lead)`}
                </Badge>
                <Badge tone={product.customsRiskFlag === "LOW" ? "success" : product.customsRiskFlag === "MEDIUM" ? "warning" : "critical"}>
                  {`Customs: ${product.customsRiskFlag}`}
                </Badge>
              </InlineStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Pricing</Text>
              <InlineStack gap="400">
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">Suggested Price</Text>
                  <Text as="span" variant="headingLg">${Number(product.suggestedPriceUsd).toFixed(2)}</Text>
                </BlockStack>
                {product.minSellerPriceUsd && (
                  <BlockStack gap="100">
                    <Text as="span" variant="bodySm" tone="subdued">Minimum Price</Text>
                    <Text as="span" variant="headingLg">${Number(product.minSellerPriceUsd).toFixed(2)}</Text>
                  </BlockStack>
                )}
              </InlineStack>
            </BlockStack>
          </Card>

          {variantRows.length > 0 && (
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Variants</Text>
                <DataTable
                  columnContentTypes={["text", "text", "numeric", "numeric", "text"]}
                  headings={["SKU", "Variant", "Price", "Stock", "Weight"]}
                  rows={variantRows}
                />
              </BlockStack>
            </Card>
          )}
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Shipping</Text>
              <Text as="p" variant="bodySm">
                Ships to: {(product.eligibleCountries as string[]).join(", ")}
              </Text>
              {product.weightKg && (
                <Text as="p" variant="bodySm">
                  Weight: {Number(product.weightKg)} kg
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
