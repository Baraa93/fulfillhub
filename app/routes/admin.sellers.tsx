import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { requireAdmin } from "~/admin.server";
import { prisma } from "~/db.server";
import { logAudit } from "~/services/audit.server";
import { Prisma } from "@prisma/client";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdmin(request);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || undefined;
  const search = url.searchParams.get("search") || undefined;
  const page = Number(url.searchParams.get("page") || "1");
  const limit = 50;

  const where: Prisma.SellerWhereInput = {};
  if (status) where.status = status as "ACTIVE" | "INACTIVE" | "SUSPENDED";
  if (search) {
    where.OR = [
      { shopName: { contains: search, mode: "insensitive" } },
      { shopDomain: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }

  const [sellers, total] = await Promise.all([
    prisma.seller.findMany({
      where,
      include: {
        _count: { select: { orders: true, sellerProducts: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.seller.count({ where }),
  ]);

  return json({
    sellers: sellers.map((s) => ({
      ...s,
      walletBalance: Number(s.walletBalance),
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

  if (intent === "adjust_wallet") {
    const sellerId = formData.get("sellerId") as string;
    const amount = Number(formData.get("amount"));
    const description = (formData.get("description") as string) || "Manual adjustment";

    if (!sellerId || !amount || isNaN(amount)) {
      return json({ error: "Seller ID and valid amount are required" }, { status: 400 });
    }

    const seller = await prisma.seller.findUnique({ where: { id: sellerId } });
    if (!seller) return json({ error: "Seller not found" }, { status: 404 });

    const newBalance = Number(seller.walletBalance) + amount;

    await prisma.$transaction([
      prisma.seller.update({
        where: { id: sellerId },
        data: { walletBalance: newBalance },
      }),
      prisma.walletTransaction.create({
        data: {
          sellerId,
          type: amount > 0 ? "CREDIT" : "DEBIT",
          amount: new Prisma.Decimal(amount),
          balanceAfter: new Prisma.Decimal(newBalance),
          description,
          referenceType: "adjustment",
          createdBy: admin.id,
        },
      }),
    ]);

    await logAudit({
      actorType: "ADMIN",
      actorId: admin.id,
      action: "wallet.adjusted",
      entityType: "Seller",
      entityId: sellerId,
      sellerId,
      details: { amount, newBalance, description },
    });

    return json({ success: true, message: `Wallet adjusted by $${amount.toFixed(2)}. New balance: $${newBalance.toFixed(2)}` });
  }

  if (intent === "toggle_status") {
    const sellerId = formData.get("sellerId") as string;
    const currentStatus = formData.get("currentStatus") as string;
    const newStatus = currentStatus === "ACTIVE" ? "SUSPENDED" : "ACTIVE";

    await prisma.seller.update({
      where: { id: sellerId },
      data: { status: newStatus },
    });

    await logAudit({
      actorType: "ADMIN",
      actorId: admin.id,
      action: `seller.${newStatus.toLowerCase()}`,
      entityType: "Seller",
      entityId: sellerId,
      sellerId,
    });

    return json({ success: true, message: `Seller ${newStatus === "ACTIVE" ? "activated" : "suspended"}` });
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

export default function AdminSellers() {
  const { sellers, total, page, totalPages } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const [walletSellerId, setWalletSellerId] = useState<string | null>(null);

  const currentStatus = searchParams.get("status") || "";
  const currentSearch = searchParams.get("search") || "";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Sellers</h1>
        <span style={{ fontSize: 14, color: "#6b7280" }}>{total} sellers</span>
      </div>

      {actionData && "error" in actionData && (
        <div style={{ padding: "10px 14px", backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#dc2626", fontSize: 14, marginBottom: 16 }}>{actionData.error}</div>
      )}
      {actionData && "message" in actionData && (
        <div style={{ padding: "10px 14px", backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, color: "#16a34a", fontSize: 14, marginBottom: 16 }}>{actionData.message}</div>
      )}

      {/* Search + Filter */}
      <Form method="get" style={{ display: "flex", gap: 12, marginBottom: 20, alignItems: "end" }}>
        <div>
          <label style={labelStyle}>Search</label>
          <input name="search" defaultValue={currentSearch} placeholder="Shop name, domain, email..." style={{ ...inputStyle, width: 260 }} />
        </div>
        <div>
          <label style={labelStyle}>Status</label>
          <select name="status" defaultValue={currentStatus} style={inputStyle}>
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
        </div>
        <button type="submit" style={btnPrimary}>Search</button>
      </Form>

      {/* Wallet adjustment modal */}
      {walletSellerId && (
        <div style={{ backgroundColor: "#fff", borderRadius: 8, padding: 24, marginBottom: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
          <h2 style={{ margin: "0 0 16px", fontSize: 16 }}>Adjust Wallet — {sellers.find((s) => s.id === walletSellerId)?.shopName}</h2>
          <Form method="post" onSubmit={() => setWalletSellerId(null)}>
            <input type="hidden" name="intent" value="adjust_wallet" />
            <input type="hidden" name="sellerId" value={walletSellerId} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 16 }}>
              <div>
                <label style={labelStyle}>Amount (USD, negative to deduct)</label>
                <input name="amount" type="number" step="0.01" required style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={labelStyle}>Description</label>
                <input name="description" placeholder="Reason for adjustment" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
              </div>
            </div>
            <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <button type="submit" disabled={navigation.state === "submitting"} style={btnPrimary}>Apply</button>
              <button type="button" onClick={() => setWalletSellerId(null)} style={btnSecondary}>Cancel</button>
            </div>
          </Form>
        </div>
      )}

      {/* Sellers table */}
      <div style={{ backgroundColor: "#fff", borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
              <th style={thStyle}>Shop</th>
              <th style={thStyle}>Email</th>
              <th style={thStyle}>Balance</th>
              <th style={thStyle}>Orders</th>
              <th style={thStyle}>Products</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Installed</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sellers.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 32, textAlign: "center", color: "#999" }}>No sellers found.</td></tr>
            )}
            {sellers.map((seller) => (
              <tr key={seller.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 600 }}>{seller.shopName || "Unnamed"}</div>
                  <div style={{ fontSize: 12, color: "#9ca3af" }}>{seller.shopDomain}</div>
                </td>
                <td style={tdStyle}>{seller.email || "—"}</td>
                <td style={tdStyle}>
                  <span style={{ fontWeight: 600, color: seller.walletBalance > 0 ? "#166534" : seller.walletBalance < 0 ? "#dc2626" : "#374151" }}>
                    ${seller.walletBalance.toFixed(2)}
                  </span>
                </td>
                <td style={tdStyle}>{seller._count.orders}</td>
                <td style={tdStyle}>{seller._count.sellerProducts}</td>
                <td style={tdStyle}>
                  <span style={{
                    padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600,
                    backgroundColor: seller.status === "ACTIVE" ? "#dcfce7" : seller.status === "SUSPENDED" ? "#fee2e2" : "#f3f4f6",
                    color: seller.status === "ACTIVE" ? "#166534" : seller.status === "SUSPENDED" ? "#991b1b" : "#374151",
                  }}>
                    {seller.status}
                  </span>
                </td>
                <td style={tdStyle}>
                  <div style={{ fontSize: 13 }}>{new Date(seller.installedAt).toLocaleDateString()}</div>
                </td>
                <td style={tdStyle}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => setWalletSellerId(seller.id)} style={actionBtn}>Wallet</button>
                    <Form method="post" style={{ display: "inline" }}>
                      <input type="hidden" name="intent" value="toggle_status" />
                      <input type="hidden" name="sellerId" value={seller.id} />
                      <input type="hidden" name="currentStatus" value={seller.status} />
                      <button type="submit" style={{ ...actionBtn, color: seller.status === "ACTIVE" ? "#dc2626" : "#16a34a" }}>
                        {seller.status === "ACTIVE" ? "Suspend" : "Activate"}
                      </button>
                    </Form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 16 }}>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              to={`/admin/sellers?page=${p}${currentStatus ? `&status=${currentStatus}` : ""}${currentSearch ? `&search=${currentSearch}` : ""}`}
              style={{
                padding: "4px 10px", borderRadius: 4, fontSize: 13, textDecoration: "none",
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

const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4, color: "#374151" };
const inputStyle: React.CSSProperties = { padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 };
const thStyle: React.CSSProperties = { padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" };
const tdStyle: React.CSSProperties = { padding: "10px 14px" };
const btnPrimary: React.CSSProperties = { padding: "8px 16px", backgroundColor: "#6c5ce7", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 };
const btnSecondary: React.CSSProperties = { padding: "8px 16px", backgroundColor: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer", fontSize: 14 };
const actionBtn: React.CSSProperties = { background: "none", border: "none", color: "#6c5ce7", cursor: "pointer", fontSize: 13, padding: "2px 6px" };
