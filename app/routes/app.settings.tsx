import {
  json,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useActionData, Form } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  TextField,
  Button,
  Banner,
  Checkbox,
  FormLayout,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import { getOrCreateSeller } from "~/seller.server";
import { prisma } from "~/db.server";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const seller = await getOrCreateSeller(session);

  return json({
    packagingInsert: seller.packagingInsert || "",
    brandedPackaging: seller.brandedPackaging,
    packagingNotes: seller.packagingNotes || "",
    shopName: seller.shopName || seller.shopDomain,
    email: seller.email || "",
    currency: seller.currency,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const seller = await getOrCreateSeller(session);

  const formData = await request.formData();
  const packagingInsert = String(formData.get("packagingInsert") || "").trim();
  const brandedPackaging = formData.get("brandedPackaging") === "true";
  const packagingNotes = String(formData.get("packagingNotes") || "").trim();

  await prisma.seller.update({
    where: { id: seller.id },
    data: {
      packagingInsert: packagingInsert || null,
      brandedPackaging,
      packagingNotes: packagingNotes || null,
    },
  });

  return json({ success: true });
};

export default function SellerSettings() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  const [packagingInsert, setPackagingInsert] = useState(data.packagingInsert);
  const [brandedPackaging, setBrandedPackaging] = useState(data.brandedPackaging);
  const [packagingNotes, setPackagingNotes] = useState(data.packagingNotes);

  return (
    <Page title="Settings">
      <Layout>
        {actionData?.success && (
          <Layout.Section>
            <Banner title="Settings saved" tone="success" />
          </Layout.Section>
        )}

        {/* Store info (read-only) */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingSm">Store Information</Text>
              <Text as="p" variant="bodyMd">
                <strong>Store:</strong> {data.shopName}
              </Text>
              <Text as="p" variant="bodyMd">
                <strong>Email:</strong> {data.email || "Not set"}
              </Text>
              <Text as="p" variant="bodyMd">
                <strong>Currency:</strong> {data.currency}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Packaging preferences */}
        <Layout.Section>
          <Card>
            <Form method="post">
              <FormLayout>
                <Text as="h2" variant="headingSm">Packaging Preferences</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Customize how your orders are packaged and shipped to your
                  customers. These preferences are applied by our warehouse team.
                </Text>

                <TextField
                  label="Insert Card Text"
                  value={packagingInsert}
                  onChange={setPackagingInsert}
                  name="packagingInsert"
                  multiline={3}
                  helpText="Text printed on an insert card included with each order (e.g., thank you note, discount code)."
                  autoComplete="off"
                />

                <Checkbox
                  label="Use branded packaging"
                  checked={brandedPackaging}
                  onChange={setBrandedPackaging}
                  helpText="Request that orders are shipped in branded packaging with your store name. Additional fees may apply."
                />
                <input
                  type="hidden"
                  name="brandedPackaging"
                  value={String(brandedPackaging)}
                />

                <TextField
                  label="Additional Packaging Notes"
                  value={packagingNotes}
                  onChange={setPackagingNotes}
                  name="packagingNotes"
                  multiline={3}
                  helpText="Any special instructions for our warehouse team (e.g., fragile handling, gift wrap preferences)."
                  autoComplete="off"
                />

                <Button submit variant="primary">
                  Save Settings
                </Button>
              </FormLayout>
            </Form>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
