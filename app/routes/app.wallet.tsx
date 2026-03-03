import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  DataTable,
  Badge,
  Banner,
} from "@shopify/polaris";
import { getWalletTransactions } from "~/services/wallet.server";
import { prisma } from "~/db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // TODO: Get sellerId from Shopify session
  const sellerId = "TODO_FROM_SESSION";

  const seller = await prisma.seller.findUnique({
    where: { id: sellerId },
    select: { walletBalance: true, currency: true },
  });

  const { transactions, total } = await getWalletTransactions(sellerId, {
    page: 1,
    limit: 50,
  });

  return json({
    balance: seller?.walletBalance || "0.00",
    currency: seller?.currency || "USD",
    transactions,
    total,
  });
};

export default function SellerWallet() {
  const { balance, currency, transactions } = useLoaderData<typeof loader>();

  const rows = (transactions as any[]).map((txn) => [
    new Date(txn.createdAt).toLocaleString(),
    txn.type,
    Number(txn.amount) > 0 ? `+$${Number(txn.amount).toFixed(2)}` : `$${Number(txn.amount).toFixed(2)}`,
    `$${Number(txn.balanceAfter).toFixed(2)}`,
    txn.description,
  ]);

  return (
    <Page title="Wallet">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingSm">Current Balance</Text>
              <Text as="p" variant="heading2xl">
                ${Number(balance).toFixed(2)} {currency}
              </Text>
            </BlockStack>
          </Card>

          {Number(balance) < 50 && (
            <Banner title="Low Balance" tone="warning">
              <p>
                Your wallet balance is low. Orders will be held until you top up.
                Please contact us to add funds to your account.
              </p>
            </Banner>
          )}

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Top-Up Instructions</Text>
              <Text as="p" variant="bodyMd">
                To top up your wallet, transfer funds to the following account
                and notify us with the reference number:
              </Text>
              <Text as="p" variant="bodyMd" fontWeight="bold">
                Bank: [Bank Name]
                <br />
                Account: [Account Number]
                <br />
                IBAN: [IBAN]
                <br />
                Reference: Your shop domain
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Transaction History</Text>
              <DataTable
                columnContentTypes={["text", "text", "numeric", "numeric", "text"]}
                headings={["Date", "Type", "Amount", "Balance After", "Description"]}
                rows={rows}
              />
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
