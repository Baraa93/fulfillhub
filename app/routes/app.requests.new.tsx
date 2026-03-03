import { json, type ActionFunctionArgs } from "@remix-run/node";
import { useActionData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Select,
  Button,
  Banner,
  BlockStack,
  Text,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "~/shopify.server";
import { getOrCreateSeller } from "~/seller.server";
import { submitProductRequest } from "~/services/product-request.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const seller = await getOrCreateSeller(session);

  const formData = await request.formData();
  const trendyolUrl = formData.get("trendyolUrl") as string;
  const notes = formData.get("notes") as string;
  const desiredCategory = formData.get("desiredCategory") as string;

  try {
    const productRequest = await submitProductRequest(
      seller.id,
      trendyolUrl,
      notes || undefined,
      desiredCategory || undefined,
    );
    return json({ success: true, requestId: productRequest.id });
  } catch (error) {
    return json(
      { success: false, error: error instanceof Error ? error.message : "Failed to submit" },
      { status: 400 },
    );
  }
};

export default function NewProductRequest() {
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [trendyolUrl, setTrendyolUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [desiredCategory, setDesiredCategory] = useState("");

  const handleSubmit = () => {
    const formData = new FormData();
    formData.set("trendyolUrl", trendyolUrl);
    formData.set("notes", notes);
    formData.set("desiredCategory", desiredCategory);
    submit(formData, { method: "post" });
  };

  return (
    <Page
      title="Request a Product"
      subtitle="Submit a Trendyol link for review. If approved, the product will be added to our catalog."
      backAction={{ url: "/app/requests" }}
    >
      <Layout>
        <Layout.Section>
          {actionData?.success && (
            <Banner title="Request submitted!" tone="success">
              <p>
                Your product request has been submitted for review.
                We'll notify you once it's been reviewed.
              </p>
            </Banner>
          )}

          {actionData && !actionData.success && "error" in actionData && (
            <Banner title="Error" tone="critical">
              <p>{actionData.error as string}</p>
            </Banner>
          )}

          <Card>
            <BlockStack gap="400">
              <Text as="p" variant="bodyMd">
                Paste a Trendyol product link below. Our team will review the product
                for quality, shipping feasibility, and margin potential. If approved,
                it will be added to the catalog with our own SKU and pricing.
              </Text>

              <FormLayout>
                <TextField
                  label="Trendyol Product URL"
                  value={trendyolUrl}
                  onChange={setTrendyolUrl}
                  placeholder="https://www.trendyol.com/brand/product-name-p-123456789"
                  helpText="Must be a valid Trendyol product URL"
                  autoComplete="off"
                />

                <Select
                  label="Desired Category"
                  options={[
                    { label: "Select category...", value: "" },
                    { label: "Fashion", value: "Fashion" },
                    { label: "Home & Living", value: "Home & Living" },
                    { label: "Beauty & Personal Care", value: "Beauty & Personal Care" },
                    { label: "Electronics & Accessories", value: "Electronics & Accessories" },
                    { label: "Baby & Kids", value: "Baby & Kids" },
                    { label: "Sports & Outdoors", value: "Sports & Outdoors" },
                    { label: "Other", value: "Other" },
                  ]}
                  value={desiredCategory}
                  onChange={setDesiredCategory}
                />

                <TextField
                  label="Notes (optional)"
                  value={notes}
                  onChange={setNotes}
                  multiline={3}
                  placeholder="Why do you want this product? Any market insights?"
                  autoComplete="off"
                />

                <Button
                  variant="primary"
                  onClick={handleSubmit}
                  loading={isSubmitting}
                  disabled={!trendyolUrl}
                >
                  Submit Request
                </Button>
              </FormLayout>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
