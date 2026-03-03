import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  ResourceList,
  ResourceItem,
  Text,
  Badge,
  BlockStack,
  InlineStack,
  Filters,
  Pagination,
  Select,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import { getOrCreateSeller } from "~/seller.server";
import { getSellerOrders } from "~/services/order.server";

const STATUS_BADGE_MAP: Record<string, { tone: any; label: string }> = {
  PENDING_PAYMENT: { tone: "warning", label: "Pending Payment" },
  PROCESSING: { tone: "info", label: "Processing" },
  PURCHASED: { tone: "info", label: "Purchased" },
  ALLOCATED: { tone: "info", label: "Allocated" },
  PACKED: { tone: "attention", label: "Packed" },
  SHIPPED: { tone: "success", label: "Shipped" },
  DELIVERED: { tone: "success", label: "Delivered" },
  EXCEPTION: { tone: "critical", label: "Exception" },
  CANCELLED: { tone: "critical", label: "Cancelled" },
  RETURNED: { tone: "warning", label: "Returned" },
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const seller = await getOrCreateSeller(session);

  const url = new URL(request.url);
  const status = url.searchParams.get("status") || undefined;
  const page = Number(url.searchParams.get("page")) || 1;

  const result = await getSellerOrders(seller.id, {
    status: status as any,
    page,
    limit: 20,
  });

  return json(result);
};

export default function SellerOrders() {
  const { orders, total, page, totalPages } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  return (
    <Page title="My Orders" subtitle={`${total} total orders`}>
      <Layout>
        <Layout.Section>
          <Card padding="0">
            <ResourceList
              resourceName={{ singular: "order", plural: "orders" }}
              items={orders}
              filterControl={
                <div style={{ padding: "12px" }}>
                  <Select
                    label="Status"
                    labelInline
                    options={[
                      { label: "All", value: "" },
                      { label: "Processing", value: "PROCESSING" },
                      { label: "Shipped", value: "SHIPPED" },
                      { label: "Delivered", value: "DELIVERED" },
                      { label: "Exception", value: "EXCEPTION" },
                    ]}
                    value={searchParams.get("status") || ""}
                    onChange={(value) => {
                      const params = new URLSearchParams(searchParams);
                      if (value) {
                        params.set("status", value);
                      } else {
                        params.delete("status");
                      }
                      params.set("page", "1");
                      setSearchParams(params);
                    }}
                  />
                </div>
              }
              renderItem={(order) => {
                const { id, shopifyOrderName, status, customerName, shippingCountry, totalAmountUsd, createdAt, shipments } = order as any;
                const badge = STATUS_BADGE_MAP[status] || { tone: "info", label: status };
                const latestShipment = (shipments as any[])?.[0];

                return (
                  <ResourceItem
                    id={id}
                    url={`/app/orders/${id}`}
                    accessibilityLabel={`View order ${shopifyOrderName}`}
                  >
                    <BlockStack gap="100">
                      <InlineStack align="space-between">
                        <InlineStack gap="200">
                          <Text as="h3" variant="bodyMd" fontWeight="bold">
                            {shopifyOrderName || id.slice(0, 8)}
                          </Text>
                          <Badge tone={badge.tone}>{badge.label}</Badge>
                        </InlineStack>
                        <Text as="span" variant="bodyMd" fontWeight="bold">
                          ${Number(totalAmountUsd).toFixed(2)}
                        </Text>
                      </InlineStack>
                      <InlineStack gap="200">
                        <Text as="span" variant="bodySm" tone="subdued">
                          {customerName} — {shippingCountry}
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {new Date(createdAt).toLocaleDateString()}
                        </Text>
                      </InlineStack>
                      {latestShipment?.trackingNumber && (
                        <InlineStack gap="200">
                          <Text as="span" variant="bodySm">
                            Tracking: {latestShipment.trackingNumber}
                          </Text>
                          {latestShipment.trackingPushed && (
                            <Badge tone="success">Pushed to Shopify</Badge>
                          )}
                        </InlineStack>
                      )}
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
