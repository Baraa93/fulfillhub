import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, Text, BlockStack, InlineGrid, Box } from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import { getOrCreateSeller } from "~/seller.server";
import { prisma } from "~/db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const seller = await getOrCreateSeller(session);

  const [activeProducts, openOrders, pendingRequests] = await Promise.all([
    prisma.sellerProduct.count({ where: { sellerId: seller.id, status: "ACTIVE" } }),
    prisma.order.count({
      where: { sellerId: seller.id, status: { in: ["PROCESSING", "PURCHASED", "ALLOCATED", "PACKED"] } },
    }),
    prisma.productRequest.count({ where: { sellerId: seller.id, status: "PENDING" } }),
  ]);

  return json({
    shopName: seller.shopName || seller.shopDomain,
    stats: {
      activeProducts,
      openOrders,
      walletBalance: seller.walletBalance.toString(),
      pendingRequests,
    },
  });
};

export default function SellerHome() {
  const { shopName, stats } = useLoaderData<typeof loader>();

  return (
    <Page title={`Welcome, ${shopName}`}>
      <Layout>
        <Layout.Section>
          <InlineGrid columns={4} gap="400">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Active Products</Text>
                <Text as="p" variant="headingLg">{stats.activeProducts}</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Open Orders</Text>
                <Text as="p" variant="headingLg">{stats.openOrders}</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Wallet Balance</Text>
                <Text as="p" variant="headingLg">${stats.walletBalance}</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Pending Requests</Text>
                <Text as="p" variant="headingLg">{stats.pendingRequests}</Text>
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Getting Started</Text>
              <Text as="p" variant="bodyMd">
                Browse our curated catalog to find products to import into your store.
                When a customer places an order, we handle fulfillment — purchasing,
                QC, packing with your branding, and shipping via Aramex or SMSA.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
