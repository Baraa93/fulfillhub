import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { requireAdmin } from "~/admin.server";
import { prisma } from "~/db.server";
import { createCatalogProduct, updateCatalogProduct } from "~/services/catalog.server";

const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4, color: "#374151" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, boxSizing: "border-box" };
const btnPrimary: React.CSSProperties = { padding: "8px 16px", backgroundColor: "#6c5ce7", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 };
const btnSecondary: React.CSSProperties = { padding: "8px 16px", backgroundColor: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer", fontSize: 14 };

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request);

  if (params.id === "new") {
    return json({ product: null, isNew: true });
  }

  const product = await prisma.catalogProduct.findUnique({
    where: { id: params.id },
    include: { variants: true },
  });

  if (!product) {
    throw new Response("Product not found", { status: 404 });
  }

  const serialized = {
    ...product,
    supplierCost: Number(product.supplierCost),
    suggestedPriceUsd: Number(product.suggestedPriceUsd),
    minSellerPriceUsd: product.minSellerPriceUsd ? Number(product.minSellerPriceUsd) : null,
    weightKg: product.weightKg ? Number(product.weightKg) : null,
    lengthCm: product.lengthCm ? Number(product.lengthCm) : null,
    widthCm: product.widthCm ? Number(product.widthCm) : null,
    heightCm: product.heightCm ? Number(product.heightCm) : null,
    variants: product.variants.map((v: any) => ({
      ...v,
      price: v.price ? Number(v.price) : null,
      cost: v.cost ? Number(v.cost) : null,
      weightKg: v.weightKg ? Number(v.weightKg) : null,
    })),
  };

  return json({ product: serialized, isNew: false });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const admin = await requireAdmin(request);
  const formData = await request.formData();

  const isNew = formData.get("isNew") === "true";
  const statusAction = formData.get("statusAction") as string | null;

  const sku = formData.get("sku") as string;
  const title = formData.get("title") as string;
  const supplierCost = parseFloat(formData.get("supplierCost") as string);
  const suggestedPriceUsd = parseFloat(formData.get("suggestedPriceUsd") as string);

  if (!sku || !title || isNaN(supplierCost) || isNaN(suggestedPriceUsd)) {
    return json({ error: "SKU, Title, Supplier Cost, and Suggested Price USD are required." }, { status: 400 });
  }

  const description = (formData.get("description") as string) || undefined;
  const bodyHtml = (formData.get("bodyHtml") as string) || undefined;
  const category = (formData.get("category") as string) || undefined;
  const vendor = (formData.get("vendor") as string) || undefined;
  const productType = (formData.get("productType") as string) || undefined;
  const sourceUrl = (formData.get("sourceUrl") as string) || undefined;
  const supplierName = (formData.get("supplierName") as string) || undefined;
  const costCurrency = (formData.get("costCurrency") as string) || "TRY";

  const tagsRaw = (formData.get("tags") as string) || "";
  const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : [];

  const imagesRaw = (formData.get("images") as string) || "";
  const images = imagesRaw ? imagesRaw.split("\n").map((u) => u.trim()).filter(Boolean) : [];

  const eligibleCountries = formData.getAll("eligibleCountries") as string[];

  const customsRiskFlag = (formData.get("customsRiskFlag") as string) || undefined;
  const stockType = (formData.get("stockType") as string) || undefined;

  const weightKgRaw = formData.get("weightKg") as string;
  const lengthCmRaw = formData.get("lengthCm") as string;
  const widthCmRaw = formData.get("widthCm") as string;
  const heightCmRaw = formData.get("heightCm") as string;
  const stockQuantityRaw = formData.get("stockQuantity") as string;
  const leadTimeDaysRaw = formData.get("leadTimeDays") as string;
  const minSellerPriceUsdRaw = formData.get("minSellerPriceUsd") as string;

  const weightKg = weightKgRaw ? parseFloat(weightKgRaw) : undefined;
  const lengthCm = lengthCmRaw ? parseFloat(lengthCmRaw) : undefined;
  const widthCm = widthCmRaw ? parseFloat(widthCmRaw) : undefined;
  const heightCm = heightCmRaw ? parseFloat(heightCmRaw) : undefined;
  const stockQuantity = stockQuantityRaw ? parseInt(stockQuantityRaw, 10) : undefined;
  const leadTimeDays = leadTimeDaysRaw ? parseInt(leadTimeDaysRaw, 10) : undefined;
  const minSellerPriceUsd = minSellerPriceUsdRaw ? parseFloat(minSellerPriceUsdRaw) : undefined;

  const input = {
    sku,
    title,
    description,
    bodyHtml,
    category,
    tags,
    images,
    vendor,
    productType,
    sourceUrl,
    supplierName,
    supplierCost,
    costCurrency,
    suggestedPriceUsd,
    minSellerPriceUsd,
    weightKg,
    lengthCm,
    widthCm,
    heightCm,
    eligibleCountries: eligibleCountries.length > 0 ? eligibleCountries : undefined,
    customsRiskFlag,
    stockType,
    stockQuantity,
    leadTimeDays,
  };

  if (isNew) {
    await createCatalogProduct(input, admin.id);
    return redirect("/admin/catalog");
  }

  if (statusAction) {
    await prisma.catalogProduct.update({
      where: { id: params.id },
      data: { status: statusAction },
    });
    return json({ success: `Status updated to ${statusAction}.` });
  }

  await updateCatalogProduct(params.id!, input, admin.id);
  return json({ success: "Product updated successfully." });
}

const COUNTRIES = ["AE", "SA", "KW", "QA", "OM", "BH"];

export default function AdminCatalogProductPage() {
  const { product, isNew } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const sectionStyle: React.CSSProperties = { marginBottom: 28 };
  const sectionTitle: React.CSSProperties = { fontSize: 15, fontWeight: 600, color: "#1f2937", marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid #e5e7eb" };
  const gridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 };
  const fieldStyle: React.CSSProperties = { marginBottom: 0 };

  function nextStatus(current: string): { label: string; value: string } | null {
    switch (current) {
      case "DRAFT": return { label: "Activate", value: "ACTIVE" };
      case "ACTIVE": return { label: "Deactivate", value: "INACTIVE" };
      case "INACTIVE": return { label: "Re-activate", value: "ACTIVE" };
      default: return null;
    }
  }

  return (
    <div style={{ padding: "24px 32px", maxWidth: 900, margin: "0 auto" }}>
      <Link to="/admin/catalog" style={{ color: "#6c5ce7", textDecoration: "none", fontSize: 13, fontWeight: 500 }}>
        &larr; Back to Catalog
      </Link>

      <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1f2937", margin: "16px 0 24px" }}>
        {isNew ? "New Product" : `Edit: ${product?.title}`}
      </h1>

      {actionData && "error" in actionData && (
        <div style={{ padding: "10px 14px", backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#dc2626", fontSize: 13, marginBottom: 16 }}>
          {actionData.error}
        </div>
      )}

      {actionData && "success" in actionData && (
        <div style={{ padding: "10px 14px", backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, color: "#16a34a", fontSize: 13, marginBottom: 16 }}>
          {actionData.success}
        </div>
      )}

      <div style={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 28 }}>
        <Form method="post">
          {isNew && <input type="hidden" name="isNew" value="true" />}

          {/* Basic Info */}
          <div style={sectionStyle}>
            <h2 style={sectionTitle}>Basic Info</h2>
            <div style={gridStyle}>
              <div style={fieldStyle}>
                <label style={labelStyle}>SKU *</label>
                <input name="sku" type="text" required defaultValue={product?.sku ?? ""} style={inputStyle} />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Title *</label>
                <input name="title" type="text" required defaultValue={product?.title ?? ""} style={inputStyle} />
              </div>
              <div style={{ ...fieldStyle, gridColumn: "1 / -1" }}>
                <label style={labelStyle}>Description</label>
                <textarea name="description" rows={3} defaultValue={product?.description ?? ""} style={{ ...inputStyle, resize: "vertical" }} />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Category</label>
                <input name="category" type="text" defaultValue={product?.category ?? ""} style={inputStyle} />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Vendor</label>
                <input name="vendor" type="text" defaultValue={product?.vendor ?? ""} style={inputStyle} />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Product Type</label>
                <input name="productType" type="text" defaultValue={product?.productType ?? ""} style={inputStyle} />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Tags (comma-separated)</label>
                <input name="tags" type="text" defaultValue={product?.tags?.join(", ") ?? ""} style={inputStyle} />
              </div>
              <div style={{ ...fieldStyle, gridColumn: "1 / -1" }}>
                <label style={labelStyle}>Source URL</label>
                <input name="sourceUrl" type="url" defaultValue={product?.sourceUrl ?? ""} style={inputStyle} />
              </div>
            </div>
          </div>

          {/* Pricing */}
          <div style={sectionStyle}>
            <h2 style={sectionTitle}>Pricing</h2>
            <div style={gridStyle}>
              <div style={fieldStyle}>
                <label style={labelStyle}>Supplier Cost *</label>
                <input name="supplierCost" type="number" step="0.01" required defaultValue={product?.supplierCost ?? ""} style={inputStyle} />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Cost Currency</label>
                <select name="costCurrency" defaultValue={product?.costCurrency ?? "TRY"} style={inputStyle}>
                  <option value="TRY">TRY</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Suggested Price USD *</label>
                <input name="suggestedPriceUsd" type="number" step="0.01" required defaultValue={product?.suggestedPriceUsd ?? ""} style={inputStyle} />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Min Seller Price USD</label>
                <input name="minSellerPriceUsd" type="number" step="0.01" defaultValue={product?.minSellerPriceUsd ?? ""} style={inputStyle} />
              </div>
            </div>
          </div>

          {/* Shipping & Eligibility */}
          <div style={sectionStyle}>
            <h2 style={sectionTitle}>Shipping &amp; Eligibility</h2>
            <div style={gridStyle}>
              <div style={fieldStyle}>
                <label style={labelStyle}>Weight (KG)</label>
                <input name="weightKg" type="number" step="0.01" defaultValue={product?.weightKg ?? ""} style={inputStyle} />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Length (cm)</label>
                <input name="lengthCm" type="number" step="0.1" defaultValue={product?.lengthCm ?? ""} style={inputStyle} />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Width (cm)</label>
                <input name="widthCm" type="number" step="0.1" defaultValue={product?.widthCm ?? ""} style={inputStyle} />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Height (cm)</label>
                <input name="heightCm" type="number" step="0.1" defaultValue={product?.heightCm ?? ""} style={inputStyle} />
              </div>
              <div style={{ ...fieldStyle, gridColumn: "1 / -1" }}>
                <label style={labelStyle}>Eligible Countries</label>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 4 }}>
                  {COUNTRIES.map((code) => (
                    <label key={code} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "#374151" }}>
                      <input
                        type="checkbox"
                        name="eligibleCountries"
                        value={code}
                        defaultChecked={product?.eligibleCountries?.includes(code) ?? false}
                      />
                      {code}
                    </label>
                  ))}
                </div>
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Customs Risk</label>
                <select name="customsRiskFlag" defaultValue={product?.customsRiskFlag ?? ""} style={inputStyle}>
                  <option value="">-- Select --</option>
                  <option value="LOW">LOW</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="HIGH">HIGH</option>
                </select>
              </div>
            </div>
          </div>

          {/* Stock */}
          <div style={sectionStyle}>
            <h2 style={sectionTitle}>Stock</h2>
            <div style={gridStyle}>
              <div style={fieldStyle}>
                <label style={labelStyle}>Stock Type</label>
                <select name="stockType" defaultValue={product?.stockType ?? ""} style={inputStyle}>
                  <option value="">-- Select --</option>
                  <option value="IN_WAREHOUSE">IN_WAREHOUSE</option>
                  <option value="ON_DEMAND">ON_DEMAND</option>
                </select>
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Stock Quantity</label>
                <input name="stockQuantity" type="number" defaultValue={product?.stockQuantity ?? ""} style={inputStyle} />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Lead Time (Days)</label>
                <input name="leadTimeDays" type="number" defaultValue={product?.leadTimeDays ?? ""} style={inputStyle} />
              </div>
            </div>
          </div>

          {/* Images */}
          <div style={sectionStyle}>
            <h2 style={sectionTitle}>Images</h2>
            <div>
              <label style={labelStyle}>Image URLs (one per line)</label>
              <textarea
                name="images"
                rows={4}
                defaultValue={product?.images?.join("\n") ?? ""}
                style={{ ...inputStyle, resize: "vertical" }}
                placeholder={"https://example.com/image1.jpg\nhttps://example.com/image2.jpg"}
              />
            </div>
          </div>

          {/* Status */}
          {!isNew && product && (
            <div style={sectionStyle}>
              <h2 style={sectionTitle}>Status</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <span style={{
                  display: "inline-block",
                  padding: "4px 10px",
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  backgroundColor: product.status === "ACTIVE" ? "#d1fae5" : product.status === "DRAFT" ? "#fef3c7" : "#f3f4f6",
                  color: product.status === "ACTIVE" ? "#065f46" : product.status === "DRAFT" ? "#92400e" : "#374151",
                }}>
                  {product.status}
                </span>
                {nextStatus(product.status) && (
                  <button
                    type="submit"
                    name="statusAction"
                    value={nextStatus(product.status)!.value}
                    style={{ ...btnSecondary, fontSize: 12 }}
                  >
                    {nextStatus(product.status)!.label}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", paddingTop: 16, borderTop: "1px solid #e5e7eb" }}>
            <Link to="/admin/catalog" style={{ textDecoration: "none" }}>
              <button type="button" style={btnSecondary}>Cancel</button>
            </Link>
            <button type="submit" style={btnPrimary} disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : isNew ? "Create Product" : "Save Changes"}
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}
