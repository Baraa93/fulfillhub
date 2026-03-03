import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams, Link } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  ResourceList,
  ResourceItem,
  Text,
  Thumbnail,
  Filters,
  Badge,
  BlockStack,
  InlineStack,
  Pagination,
} from "@shopify/polaris";
import { browseCatalog } from "~/services/catalog.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const search = url.searchParams.get("search") || undefined;
  const category = url.searchParams.get("category") || undefined;
  const page = Number(url.searchParams.get("page")) || 1;

  const result = await browseCatalog({ search, category, page, limit: 12 });

  return json(result);
};

export default function SellerCatalog() {
  const { products, total, page, totalPages } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const handleSearchChange = (value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set("search", value);
    } else {
      params.delete("search");
    }
    params.set("page", "1");
    setSearchParams(params);
  };

  return (
    <Page title="Product Catalog" subtitle={`${total} products available`}>
      <Layout>
        <Layout.Section>
          <Card padding="0">
            <ResourceList
              resourceName={{ singular: "product", plural: "products" }}
              items={products}
              filterControl={
                <Filters
                  queryValue={searchParams.get("search") || ""}
                  onQueryChange={handleSearchChange}
                  onQueryClear={() => handleSearchChange("")}
                  filters={[]}
                  onClearAll={() => {}}
                  queryPlaceholder="Search catalog..."
                />
              }
              renderItem={(product) => {
                const { id, sku, title, category, suggestedPriceUsd, stockType, images, eligibleCountries, variants } = product as any;
                const media = images?.[0] ? (
                  <Thumbnail source={images[0]} alt={title} />
                ) : (
                  <Thumbnail source="" alt={title} />
                );

                return (
                  <ResourceItem
                    id={id}
                    url={`/app/catalog/${id}`}
                    media={media}
                    accessibilityLabel={`View ${title}`}
                  >
                    <BlockStack gap="100">
                      <InlineStack align="space-between">
                        <Text as="h3" variant="bodyMd" fontWeight="bold">
                          {title}
                        </Text>
                        <Text as="span" variant="bodyMd" fontWeight="bold">
                          ${Number(suggestedPriceUsd).toFixed(2)}
                        </Text>
                      </InlineStack>
                      <InlineStack gap="200">
                        <Text as="span" variant="bodySm" tone="subdued">
                          SKU: {sku}
                        </Text>
                        {category && <Badge>{category}</Badge>}
                        <Badge tone={stockType === "IN_WAREHOUSE" ? "success" : "info"}>
                          {stockType === "IN_WAREHOUSE" ? "In Stock" : "On Demand"}
                        </Badge>
                      </InlineStack>
                      <InlineStack gap="100">
                        <Text as="span" variant="bodySm" tone="subdued">
                          Ships to: {(eligibleCountries as string[])?.join(", ")}
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {(variants as any[])?.length || 0} variant(s)
                        </Text>
                      </InlineStack>
                    </BlockStack>
                  </ResourceItem>
                );
              }}
            />
          </Card>

          {totalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "center", padding: "16px" }}>
              <Pagination
                hasPrevious={page > 1}
                hasNext={page < totalPages}
                onPrevious={() => {
                  const params = new URLSearchParams(searchParams);
                  params.set("page", String(page - 1));
                  setSearchParams(params);
                }}
                onNext={() => {
                  const params = new URLSearchParams(searchParams);
                  params.set("page", String(page + 1));
                  setSearchParams(params);
                }}
              />
            </div>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
