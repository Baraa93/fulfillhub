import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { requireAdmin } from "~/admin.server";
import { prisma } from "~/db.server";
import { logAudit } from "~/services/audit.server";
import type { CatalogProductStatus } from "@prisma/client";

const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4, color: "#374151" };
const inputStyle: React.CSSProperties = { padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 };
const thStyle: React.CSSProperties = { padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" };
const tdStyle: React.CSSProperties = { padding: "10px 14px" };
const btnPrimary: React.CSSProperties = { padding: "8px 16px", backgroundColor: "#6c5ce7", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 };
const actionBtn: React.CSSProperties = { background: "none", border: "none", color: "#6c5ce7", cursor: "pointer", fontSize: 13, padding: "2px 6px" };

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  DRAFT: { bg: "#f3f4f6", color: "#374151" },
  ACTIVE: { bg: "#dcfce7", color: "#166534" },
  INACTIVE: { bg: "#fee2e2", color: "#991b1b" },
};

const STOCK_TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  IN_WAREHOUSE: { bg: "#dbeafe", color: "#1d4ed8" },
  ON_DEMAND: { bg: "#fef3c7", color: "#92400e" },
};

const STATUSES: CatalogProductStatus[] = ["DRAFT", "ACTIVE", "INACTIVE"];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const admin = await requireAdmin(request);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") as CatalogProductStatus | null;
  const search = url.searchParams.get("search") || "";
  const page = Number(url.searchParams.get("page") || "1");

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { sku: { contains: search, mode: "insensitive" } },
      { category: { contains: search, mode: "insensitive" } },
    ];
  }

  const limit = 50;
  const [products, total] = await Promise.all([
    prisma.catalogProduct.findMany({
      where,
      include: {
        variants: true,
        _count: { select: { sellerProducts: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.catalogProduct.count({ where }),
  ]);

  return json({
    products: products.map((p) => ({
      ...p,
      supplierCost: Number(p.supplierCost),
      suggestedPriceUsd: Number(p.suggestedPriceUsd),
      minSellerPriceUsd: p.minSellerPriceUsd ? Number(p.minSellerPriceUsd) : null,
      weightKg: p.weightKg ? Number(p.weightKg) : null,
      lengthCm: p.lengthCm ? Number(p.lengthCm) : null,
      widthCm: p.widthCm ? Number(p.widthCm) : null,
      heightCm: p.heightCm ? Number(p.heightCm) : null,
      overallScore: p.overallScore ? Number(p.overallScore) : null,
      variants: p.variants.map((v) => ({
        ...v,
        additionalCost: v.additionalCost ? Number(v.additionalCost) : null,
      })),
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const admin = await requireAdmin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "toggle_status") {
    const id = formData.get("id") as string;
    const currentStatus = formData.get("currentStatus") as string;
    const newStatus = currentStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE";

    await prisma.catalogProduct.update({
      where: { id },
      data: { status: newStatus as CatalogProductStatus },
    });

    await logAudit({
      actorType: "ADMIN",
      actorId: admin.id,
      action: "catalog.toggle_status",
      entityType: "CatalogProduct",
      entityId: id,
      details: { from: currentStatus, to: newStatus },
    });

    return json({ success: true, message: `Product status changed to ${newStatus}` });
  }

  if (intent === "delete") {
    const id = formData.get("id") as string;

    await prisma.catalogProduct.update({
      where: { id },
      data: { status: "INACTIVE" },
    });

    await logAudit({
      actorType: "ADMIN",
      actorId: admin.id,
      action: "catalog.delete",
      entityType: "CatalogProduct",
      entityId: id,
      details: { softDelete: true },
    });

    return json({ success: true, message: "Product set to INACTIVE" });
  }

  return json({ success: false, message: "Unknown intent" }, { status: 400 });
};

export default function AdminCatalog() {
  const { products, total, page, totalPages } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const currentStatus = searchParams.get("status") || "";
  const currentSearch = searchParams.get("search") || "";
  const isSubmitting = navigation.state === "submitting";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Catalog</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 14, color: "#6b7280" }}>{total} products</span>
          <Link
            to="/admin/catalog/new"
            style={{
              ...btnPrimary,
              textDecoration: "none",
              display: "inline-block",
            }}
          >
            Add Product
          </Link>
        </div>
      </div>

      {actionData && "message" in actionData && (
        <div style={{
          padding: "10px 14px",
          backgroundColor: actionData.success ? "#f0fdf4" : "#fef2f2",
          border: `1px solid ${actionData.success ? "#bbf7d0" : "#fecaca"}`,
          borderRadius: 6,
          color: actionData.success ? "#16a34a" : "#dc2626",
          fontSize: 14,
          marginBottom: 16,
        }}>
          {actionData.message}
        </div>
      )}

      {/* Status tabs */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        <Link
          to={`/admin/catalog${currentSearch ? `?search=${encodeURIComponent(currentSearch)}` : ""}`}
          style={{
            padding: "4px 12px",
            borderRadius: 16,
            fontSize: 13,
            fontWeight: 500,
            textDecoration: "none",
            backgroundColor: !currentStatus ? "#6c5ce7" : "#f3f4f6",
            color: !currentStatus ? "#fff" : "#374151",
          }}
        >
          All
        </Link>
        {STATUSES.map((s) => {
          const isActive = currentStatus === s;
          const colors = STATUS_COLORS[s];
          return (
            <Link
              key={s}
              to={`/admin/catalog?status=${s}${currentSearch ? `&search=${encodeURIComponent(currentSearch)}` : ""}`}
              style={{
                padding: "4px 12px",
                borderRadius: 16,
                fontSize: 13,
                fontWeight: 500,
                textDecoration: "none",
                backgroundColor: isActive ? colors.bg : "#f3f4f6",
                color: isActive ? colors.color : "#374151",
                border: isActive ? `1px solid ${colors.color}33` : "1px solid transparent",
              }}
            >
              {s}
            </Link>
          );
        })}
      </div>

      {/* Search */}
      <Form method="get" style={{ display: "flex", gap: 12, marginBottom: 20, alignItems: "end" }}>
        {currentStatus && <input type="hidden" name="status" value={currentStatus} />}
        <div>
          <label style={labelStyle}>Search</label>
          <input
            name="search"
            defaultValue={currentSearch}
            placeholder="SKU, title, or category..."
            style={{ ...inputStyle, width: 280 }}
          />
        </div>
        <button type="submit" style={btnPrimary}>Search</button>
      </Form>

      {/* Products table */}
      <div style={{ backgroundColor: "#fff", borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
              <th style={thStyle}>SKU</th>
              <th style={thStyle}>Title</th>
              <th style={thStyle}>Category</th>
              <th style={thStyle}>Cost</th>
              <th style={thStyle}>Price</th>
              <th style={thStyle}>Stock Type</th>
              <th style={thStyle}>Variants</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 && (
              <tr>
                <td colSpan={9} style={{ padding: 32, textAlign: "center", color: "#999" }}>
                  No products found.
                </td>
              </tr>
            )}
            {products.map((product) => {
              const statusColors = STATUS_COLORS[product.status] || STATUS_COLORS.DRAFT;
              const stockColors = STOCK_TYPE_COLORS[product.stockType] || STOCK_TYPE_COLORS.ON_DEMAND;
              return (
                <tr key={product.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={tdStyle}>
                    <Link
                      to={`/admin/catalog/${product.id}`}
                      style={{ color: "#6c5ce7", textDecoration: "none", fontWeight: 600 }}
                    >
                      {product.sku}
                    </Link>
                  </td>
                  <td style={tdStyle}>{product.title}</td>
                  <td style={tdStyle}>{product.category || "—"}</td>
                  <td style={tdStyle}>
                    {product.supplierCost.toFixed(2)} {product.costCurrency}
                  </td>
                  <td style={tdStyle}>${product.suggestedPriceUsd.toFixed(2)} USD</td>
                  <td style={tdStyle}>
                    <span style={{
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 600,
                      backgroundColor: stockColors.bg,
                      color: stockColors.color,
                    }}>
                      {product.stockType.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td style={tdStyle}>{product.variants.length}</td>
                  <td style={tdStyle}>
                    <span style={{
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 600,
                      backgroundColor: statusColors.bg,
                      color: statusColors.color,
                    }}>
                      {product.status}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <Link
                        to={`/admin/catalog/${product.id}`}
                        style={actionBtn}
                      >
                        Edit
                      </Link>
                      <Form method="post" style={{ display: "inline" }}>
                        <input type="hidden" name="intent" value="toggle_status" />
                        <input type="hidden" name="id" value={product.id} />
                        <input type="hidden" name="currentStatus" value={product.status} />
                        <button
                          type="submit"
                          style={actionBtn}
                          disabled={isSubmitting}
                        >
                          {product.status === "ACTIVE" ? "Deactivate" : "Activate"}
                        </button>
                      </Form>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 16 }}>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              to={`/admin/catalog?page=${p}${currentStatus ? `&status=${currentStatus}` : ""}${currentSearch ? `&search=${encodeURIComponent(currentSearch)}` : ""}`}
              style={{
                padding: "4px 10px",
                borderRadius: 4,
                fontSize: 13,
                textDecoration: "none",
                backgroundColor: p === page ? "#6c5ce7" : "#fff",
                color: p === page ? "#fff" : "#374151",
                border: "1px solid #d1d5db",
              }}
            >
              {p}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
