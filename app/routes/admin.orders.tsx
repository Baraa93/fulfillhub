import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { requireAdmin } from "~/admin.server";
import { prisma } from "~/db.server";
import type { OrderStatus } from "@prisma/client";

const ORDER_STATUSES: OrderStatus[] = [
  "PENDING_PAYMENT",
  "PROCESSING",
  "PURCHASED",
  "ALLOCATED",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "EXCEPTION",
  "CANCELLED",
  "RETURNED",
];

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  PENDING_PAYMENT: { bg: "#fef3c7", color: "#92400e" },
  PROCESSING: { bg: "#dbeafe", color: "#1d4ed8" },
  PURCHASED: { bg: "#e0e7ff", color: "#3730a3" },
  ALLOCATED: { bg: "#ede9fe", color: "#5b21b6" },
  PACKED: { bg: "#fce7f3", color: "#9d174d" },
  SHIPPED: { bg: "#cffafe", color: "#0e7490" },
  DELIVERED: { bg: "#dcfce7", color: "#166534" },
  EXCEPTION: { bg: "#fee2e2", color: "#991b1b" },
  CANCELLED: { bg: "#f3f4f6", color: "#374151" },
  RETURNED: { bg: "#fef2f2", color: "#dc2626" },
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdmin(request);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") as OrderStatus | null;
  const sellerId = url.searchParams.get("seller") || undefined;
  const country = url.searchParams.get("country") || undefined;
  const page = Number(url.searchParams.get("page") || "1");

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (sellerId) where.sellerId = sellerId;
  if (country) where.shippingCountry = country;

  const limit = 50;
  const [orders, total, statusCounts] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        seller: { select: { shopName: true, shopDomain: true } },
        lineItems: true,
        shipments: { select: { id: true, trackingNumber: true, carrier: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.order.count({ where }),
    prisma.order.groupBy({
      by: ["status"],
      _count: true,
    }),
  ]);

  const sellers = await prisma.seller.findMany({
    select: { id: true, shopName: true },
    orderBy: { shopName: "asc" },
  });

  const countsMap: Record<string, number> = {};
  for (const sc of statusCounts) {
    countsMap[sc.status] = sc._count;
  }

  return json({
    orders: orders.map((o) => ({
      ...o,
      totalAmountUsd: Number(o.totalAmountUsd),
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    statusCounts: countsMap,
    sellers,
  });
};

export default function AdminOrders() {
  const { orders, total, page, totalPages, statusCounts, sellers } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const currentStatus = searchParams.get("status") || "";
  const currentSeller = searchParams.get("seller") || "";
  const currentCountry = searchParams.get("country") || "";

  const totalAll = Object.values(statusCounts).reduce((s, c) => s + c, 0);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Orders</h1>
        <span style={{ fontSize: 14, color: "#6b7280" }}>{total} orders</span>
      </div>

      {/* Status pills */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        <Link
          to="/admin/orders"
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
          All ({totalAll})
        </Link>
        {ORDER_STATUSES.map((s) => {
          const count = statusCounts[s] || 0;
          if (count === 0 && s !== currentStatus) return null;
          const isActive = currentStatus === s;
          const colors = STATUS_COLORS[s];
          return (
            <Link
              key={s}
              to={`/admin/orders?status=${s}${currentSeller ? `&seller=${currentSeller}` : ""}${currentCountry ? `&country=${currentCountry}` : ""}`}
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
              {s.replace(/_/g, " ")} ({count})
            </Link>
          );
        })}
      </div>

      {/* Filters */}
      <Form method="get" style={{ display: "flex", gap: 12, marginBottom: 20, alignItems: "end" }}>
        {currentStatus && <input type="hidden" name="status" value={currentStatus} />}
        <div>
          <label style={labelStyle}>Seller</label>
          <select name="seller" defaultValue={currentSeller} style={inputStyle}>
            <option value="">All Sellers</option>
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>{s.shopName || s.id}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Country</label>
          <select name="country" defaultValue={currentCountry} style={inputStyle}>
            <option value="">All Countries</option>
            {["AE", "SA", "KW", "QA", "OM", "BH"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <button type="submit" style={btnPrimary}>Filter</button>
      </Form>

      {/* Orders table */}
      <div style={{ backgroundColor: "#fff", borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
              <th style={thStyle}>Order</th>
              <th style={thStyle}>Seller</th>
              <th style={thStyle}>Customer</th>
              <th style={thStyle}>Country</th>
              <th style={thStyle}>Items</th>
              <th style={thStyle}>Amount</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Tracking</th>
              <th style={thStyle}>Date</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr>
                <td colSpan={9} style={{ padding: 32, textAlign: "center", color: "#999" }}>
                  No orders found.
                </td>
              </tr>
            )}
            {orders.map((order) => {
              const colors = STATUS_COLORS[order.status] || STATUS_COLORS.PROCESSING;
              return (
                <tr key={order.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={tdStyle}>
                    <Link
                      to={`/admin/orders/${order.id}`}
                      style={{ color: "#6c5ce7", textDecoration: "none", fontWeight: 600 }}
                    >
                      {order.shopifyOrderName || order.shopifyOrderNumber || order.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td style={tdStyle}>{order.seller?.shopName || "—"}</td>
                  <td style={tdStyle}>
                    <div>{order.customerName || "—"}</div>
                    <div style={{ fontSize: 12, color: "#9ca3af" }}>{order.shippingCity}</div>
                  </td>
                  <td style={tdStyle}>{order.shippingCountry || "—"}</td>
                  <td style={tdStyle}>{order.lineItems.length}</td>
                  <td style={tdStyle}>${order.totalAmountUsd.toFixed(2)}</td>
                  <td style={tdStyle}>
                    <span style={{
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 600,
                      backgroundColor: colors.bg,
                      color: colors.color,
                    }}>
                      {order.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    {order.shipments.length > 0
                      ? order.shipments.map((s) => (
                          <div key={s.id} style={{ fontSize: 12 }}>
                            <span style={{ fontWeight: 500 }}>{s.carrier}</span>{" "}
                            {s.trackingNumber || "pending"}
                          </div>
                        ))
                      : <span style={{ color: "#9ca3af" }}>—</span>}
                  </td>
                  <td style={tdStyle}>
                    <div style={{ fontSize: 13 }}>{new Date(order.createdAt).toLocaleDateString()}</div>
                    <div style={{ fontSize: 11, color: "#9ca3af" }}>{new Date(order.createdAt).toLocaleTimeString()}</div>
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
              to={`/admin/orders?page=${p}${currentStatus ? `&status=${currentStatus}` : ""}${currentSeller ? `&seller=${currentSeller}` : ""}${currentCountry ? `&country=${currentCountry}` : ""}`}
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

const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4, color: "#374151" };
const inputStyle: React.CSSProperties = { padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 };
const thStyle: React.CSSProperties = { padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" };
const tdStyle: React.CSSProperties = { padding: "10px 14px" };
const btnPrimary: React.CSSProperties = { padding: "8px 16px", backgroundColor: "#6c5ce7", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 };
