import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  BlockStack,
  InlineStack,
  Box,
  Divider,
  IndexTable,
  DescriptionList,
  Banner,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import { getOrCreateSeller } from "~/seller.server";
import { prisma } from "~/db.server";

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

const STATUS_PIPELINE = [
  "PROCESSING",
  "PURCHASED",
  "ALLOCATED",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
];

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const seller = await getOrCreateSeller(session);

  const order = await prisma.order.findFirst({
    where: { id: params.id, sellerId: seller.id },
    include: {
      lineItems: {
        include: {
          catalogProduct: { select: { sku: true, title: true, images: true } },
          catalogVariant: { select: { sku: true, title: true } },
        },
      },
      shipments: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!order) {
    throw new Response("Order not found", { status: 404 });
  }

  // Convert Decimal fields to number for serialization
  const serialized = {
    ...order,
    totalAmountUsd: Number(order.totalAmountUsd),
    lineItems: order.lineItems.map((li) => ({
      ...li,
      priceUsd: Number(li.priceUsd),
      costUsd: li.costUsd ? Number(li.costUsd) : null,
    })),
    shipments: order.shipments.map((s) => ({
      ...s,
      weightKg: s.weightKg ? Number(s.weightKg) : null,
    })),
  };

  return json({ order: serialized });
};

export default function SellerOrderDetail() {
  const { order } = useLoaderData<typeof loader>();
  const badge = STATUS_BADGE_MAP[order.status] || { tone: "info", label: order.status };

  const currentIdx = STATUS_PIPELINE.indexOf(order.status);
  const isTerminal = ["EXCEPTION", "CANCELLED", "RETURNED"].includes(order.status);

  return (
    <Page
      backAction={{ content: "Orders", url: "/app/orders" }}
      title={order.shopifyOrderName || order.id.slice(0, 8)}
      titleMetadata={<Badge tone={badge.tone}>{badge.label}</Badge>}
      subtitle={`Placed ${new Date(order.createdAt).toLocaleDateString()}`}
    >
      <Layout>
        {/* Status note / exception banner */}
        {order.statusNote && (
          <Layout.Section>
            <Banner
              title="Status Note"
              tone={isTerminal ? "critical" : "info"}
            >
              <p>{order.statusNote}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Status pipeline */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingSm">Order Progress</Text>
              <InlineStack gap="100" align="start" blockAlign="center">
                {STATUS_PIPELINE.map((s, i) => {
                  const isPast = currentIdx >= 0 && i <= currentIdx;
                  const isCurrent = order.status === s;
                  return (
                    <InlineStack key={s} gap="100" blockAlign="center">
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: "50%",
                          backgroundColor: isCurrent
                            ? "#6c5ce7"
                            : isPast
                            ? "#00b894"
                            : "#dfe6e9",
                          color: isPast || isCurrent ? "#fff" : "#636e72",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        {isPast && !isCurrent ? "✓" : i + 1}
                      </div>
                      <Text
                        as="span"
                        variant="bodySm"
                        fontWeight={isCurrent ? "bold" : "regular"}
                        tone={isPast || isCurrent ? undefined : "subdued"}
                      >
                        {s.replace(/_/g, " ")}
                      </Text>
                      {i < STATUS_PIPELINE.length - 1 && (
                        <div
                          style={{
                            width: 20,
                            height: 2,
                            backgroundColor: isPast ? "#00b894" : "#dfe6e9",
                          }}
                        />
                      )}
                    </InlineStack>
                  );
                })}
              </InlineStack>
              {isTerminal && (
                <Badge tone="critical">{order.status.replace(/_/g, " ")}</Badge>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Order details */}
        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingSm">Order Details</Text>
              <DescriptionList
                items={[
                  { term: "Shopify Order", description: order.shopifyOrderName || "-" },
                  { term: "Customer", description: order.customerName || "-" },
                  { term: "Email", description: order.customerEmail || "-" },
                  {
                    term: "Shipping",
                    description: [
                      order.shippingAddress1,
                      order.shippingAddress2,
                      order.shippingCity,
                      order.shippingProvince,
                      order.shippingCountry,
                      order.shippingZip,
                    ]
                      .filter(Boolean)
                      .join(", ") || "-",
                  },
                  { term: "Phone", description: order.shippingPhone || "-" },
                  { term: "Total", description: `$${order.totalAmountUsd.toFixed(2)}` },
                  {
                    term: "Wallet Deducted",
                    description: order.walletDeducted ? "Yes" : "No",
                  },
                  {
                    term: "Carrier",
                    description: order.assignedCarrier || "Not yet assigned",
                  },
                ]}
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingSm">Timeline</Text>
              <DescriptionList
                items={[
                  {
                    term: "Created",
                    description: new Date(order.createdAt).toLocaleString(),
                  },
                  ...(order.paidAt
                    ? [{ term: "Paid", description: new Date(order.paidAt).toLocaleString() }]
                    : []),
                  ...(order.packedAt
                    ? [{ term: "Packed", description: new Date(order.packedAt).toLocaleString() }]
                    : []),
                  ...(order.shippedAt
                    ? [{ term: "Shipped", description: new Date(order.shippedAt).toLocaleString() }]
                    : []),
                  ...(order.deliveredAt
                    ? [{ term: "Delivered", description: new Date(order.deliveredAt).toLocaleString() }]
                    : []),
                ]}
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Line items */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingSm">
                Line Items ({order.lineItems.length})
              </Text>
              <IndexTable
                resourceName={{ singular: "item", plural: "items" }}
                itemCount={order.lineItems.length}
                headings={[
                  { title: "SKU" },
                  { title: "Product" },
                  { title: "Variant" },
                  { title: "Qty" },
                  { title: "Unit Price" },
                  { title: "Status" },
                ]}
                selectable={false}
              >
                {order.lineItems.map((li, i) => {
                  const liBadge = STATUS_BADGE_MAP[li.status] || { tone: "info", label: li.status };
                  return (
                    <IndexTable.Row key={li.id} id={li.id} position={i}>
                      <IndexTable.Cell>
                        <Text as="span" variant="bodyMd" fontWeight="bold">
                          {li.sku || "-"}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>{li.title}</IndexTable.Cell>
                      <IndexTable.Cell>{li.variantTitle || "-"}</IndexTable.Cell>
                      <IndexTable.Cell>{li.quantity}</IndexTable.Cell>
                      <IndexTable.Cell>${li.priceUsd.toFixed(2)}</IndexTable.Cell>
                      <IndexTable.Cell>
                        <Badge tone={liBadge.tone}>{liBadge.label}</Badge>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  );
                })}
              </IndexTable>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Shipments */}
        {order.shipments.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingSm">
                  Shipments ({order.shipments.length})
                </Text>
                {order.shipments.map((s) => (
                  <Card key={s.id}>
                    <BlockStack gap="200">
                      <InlineStack gap="200" align="space-between">
                        <InlineStack gap="200">
                          <Badge>{s.carrier}</Badge>
                          <Badge
                            tone={
                              s.status === "DELIVERED"
                                ? "success"
                                : s.status === "EXCEPTION"
                                ? "critical"
                                : "info"
                            }
                          >
                            {s.status.replace(/_/g, " ")}
                          </Badge>
                        </InlineStack>
                        {s.trackingPushed && (
                          <Badge tone="success">Synced to Shopify</Badge>
                        )}
                      </InlineStack>
                      {s.trackingNumber && (
                        <Text as="p" variant="bodyMd">
                          Tracking: <strong>{s.trackingNumber}</strong>
                          {s.trackingUrl && (
                            <>
                              {" "}
                              —{" "}
                              <a
                                href={s.trackingUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                Track Package
                              </a>
                            </>
                          )}
                        </Text>
                      )}
                      {s.estimatedDelivery && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          Est. delivery:{" "}
                          {new Date(s.estimatedDelivery).toLocaleDateString()}
                        </Text>
                      )}
                    </BlockStack>
                  </Card>
                ))}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
