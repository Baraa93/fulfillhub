import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams, useNavigate } from "@remix-run/react";
import { requireAdmin } from "~/admin.server";
import { prisma } from "~/db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdmin(request);

  const url = new URL(request.url);
  const days = Number(url.searchParams.get("days")) || 30;
  const topLimit = Number(url.searchParams.get("topLimit")) || 10;

  const since = new Date();
  since.setDate(since.getDate() - days);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    ordersToday,
    ordersByStatus,
    sellerCounts,
    lowBalanceSellers,
    recentOrders,
    topProducts,
    dailyOrders,
    revenueAgg,
  ] = await Promise.all([
    // KPI: orders today
    prisma.order.count({ where: { createdAt: { gte: todayStart } } }),

    // Order breakdown by status
    prisma.order.groupBy({
      by: ["status"],
      _count: true,
    }),

    // Seller breakdown by status
    prisma.seller.groupBy({
      by: ["status"],
      _count: true,
    }),

    // Low balance sellers (active with < $50)
    prisma.seller.count({
      where: { status: "ACTIVE", walletBalance: { lt: 50 } },
    }),

    // Orders in date range for daily trend
    prisma.order.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true, status: true, totalAmountUsd: true },
      orderBy: { createdAt: "asc" },
    }),

    // Top products by quantity ordered
    prisma.orderLineItem.groupBy({
      by: ["catalogProductId"],
      _sum: { quantity: true },
      _count: true,
      orderBy: { _sum: { quantity: "desc" } },
      take: topLimit,
      where: {
        catalogProductId: { not: null },
        order: { createdAt: { gte: since } },
      },
    }),

    // Daily order counts (raw SQL for date grouping)
    prisma.$queryRaw<Array<{ day: string; count: bigint }>>`
      SELECT DATE(\"createdAt\") as day, COUNT(*)::bigint as count
      FROM "Order"
      WHERE "createdAt" >= ${since}
      GROUP BY DATE("createdAt")
      ORDER BY day ASC
    `,

    // Total revenue in period
    prisma.order.aggregate({
      where: { createdAt: { gte: since }, walletDeducted: true },
      _sum: { totalAmountUsd: true },
      _count: true,
    }),
  ]);

  // Build status counts map
  const statusCounts: Record<string, number> = {};
  for (const s of ordersByStatus) {
    statusCounts[s.status] = s._count;
  }

  const sellerStatusCounts: Record<string, number> = {};
  for (const s of sellerCounts) {
    sellerStatusCounts[s.status] = s._count;
  }

  // Fetch product details for top products
  const productIds = topProducts
    .map((p) => p.catalogProductId)
    .filter((id): id is string => id !== null);

  const products = await prisma.catalogProduct.findMany({
    where: { id: { in: productIds } },
    select: { id: true, sku: true, title: true, category: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  // Daily trend data
  const dailyTrend = dailyOrders.map((d) => ({
    day: String(d.day),
    count: Number(d.count),
  }));

  // Status distribution for chart
  const statusDistribution = Object.entries(statusCounts).map(([status, count]) => ({
    status,
    count,
  }));

  const totalOrders = Object.values(statusCounts).reduce((a, b) => a + b, 0);
  const totalSellers =
    (sellerStatusCounts.ACTIVE || 0) +
    (sellerStatusCounts.INACTIVE || 0) +
    (sellerStatusCounts.SUSPENDED || 0);

  return json({
    days,
    kpis: {
      ordersToday,
      totalOrders,
      ordersPending: (statusCounts.PROCESSING || 0) + (statusCounts.PENDING_PAYMENT || 0),
      ordersPacked: statusCounts.PACKED || 0,
      ordersShipped: statusCounts.SHIPPED || 0,
      ordersDelivered: statusCounts.DELIVERED || 0,
      ordersException: statusCounts.EXCEPTION || 0,
      totalSellers,
      activeSellers: sellerStatusCounts.ACTIVE || 0,
      lowBalanceSellers,
      periodRevenue: Number(revenueAgg._sum.totalAmountUsd || 0),
      periodOrderCount: revenueAgg._count,
    },
    statusDistribution,
    dailyTrend,
    topProducts: topProducts.map((tp) => ({
      product: productMap.get(tp.catalogProductId!) || null,
      totalQuantity: Number(tp._sum.quantity),
      orderCount: tp._count,
    })),
  });
};

const STATUS_COLORS: Record<string, string> = {
  PENDING_PAYMENT: "#fdcb6e",
  PROCESSING: "#74b9ff",
  PURCHASED: "#a29bfe",
  ALLOCATED: "#81ecec",
  PACKED: "#55efc4",
  SHIPPED: "#0984e3",
  DELIVERED: "#00b894",
  EXCEPTION: "#d63031",
  CANCELLED: "#636e72",
  RETURNED: "#e17055",
};

export default function AdminAnalytics() {
  const { days, kpis, statusDistribution, dailyTrend, topProducts } =
    useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const handlePeriodChange = (newDays: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("days", String(newDays));
    navigate(`/admin/analytics?${params.toString()}`);
  };

  const maxDailyCount = Math.max(...dailyTrend.map((d) => d.count), 1);
  const totalStatusCount = statusDistribution.reduce((a, b) => a + b.count, 0) || 1;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Analytics</h1>
        <div style={{ display: "flex", gap: 8 }}>
          {[7, 14, 30, 60, 90].map((d) => (
            <button
              key={d}
              onClick={() => handlePeriodChange(d)}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                border: "1px solid #ddd",
                backgroundColor: days === d ? "#6c5ce7" : "#fff",
                color: days === d ? "#fff" : "#333",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: days === d ? 600 : 400,
              }}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16, marginBottom: 32 }}>
        {[
          { label: "Orders Today", value: kpis.ordersToday, color: "#6c5ce7" },
          { label: "Pending", value: kpis.ordersPending, color: "#fdcb6e" },
          { label: "Packed", value: kpis.ordersPacked, color: "#55efc4" },
          { label: "Shipped", value: kpis.ordersShipped, color: "#0984e3" },
          { label: "Delivered", value: kpis.ordersDelivered, color: "#00b894" },
          { label: "Exceptions", value: kpis.ordersException, color: "#d63031" },
          { label: "Active Sellers", value: kpis.activeSellers, color: "#0984e3" },
          { label: "Low Balance", value: kpis.lowBalanceSellers, color: "#e17055" },
          {
            label: `Revenue (${days}d)`,
            value: `$${kpis.periodRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            color: "#00b894",
          },
          { label: `Orders (${days}d)`, value: kpis.periodOrderCount, color: "#6c5ce7" },
        ].map((card) => (
          <div
            key={card.label}
            style={{
              backgroundColor: "#fff",
              borderRadius: 8,
              padding: "16px 20px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
              borderLeft: `4px solid ${card.color}`,
            }}
          >
            <p style={{ margin: 0, fontSize: 12, color: "#666" }}>{card.label}</p>
            <p style={{ margin: "6px 0 0", fontSize: 24, fontWeight: 700 }}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Two column layout for charts */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 32 }}>
        {/* Daily Order Trend (bar chart) */}
        <div
          style={{
            backgroundColor: "#fff",
            borderRadius: 8,
            padding: 24,
            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          }}
        >
          <h2 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600 }}>
            Daily Orders ({days}d)
          </h2>
          {dailyTrend.length === 0 ? (
            <p style={{ color: "#999", fontSize: 14 }}>No orders in this period.</p>
          ) : (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 160 }}>
              {dailyTrend.map((d) => {
                const height = Math.max((d.count / maxDailyCount) * 140, 2);
                const dateStr = d.day.slice(5); // MM-DD
                return (
                  <div
                    key={d.day}
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 4,
                    }}
                    title={`${d.day}: ${d.count} orders`}
                  >
                    <span style={{ fontSize: 9, color: "#999" }}>{d.count > 0 ? d.count : ""}</span>
                    <div
                      style={{
                        width: "100%",
                        maxWidth: 24,
                        height,
                        backgroundColor: "#6c5ce7",
                        borderRadius: "3px 3px 0 0",
                        minWidth: 4,
                      }}
                    />
                    {dailyTrend.length <= 31 && (
                      <span
                        style={{
                          fontSize: 8,
                          color: "#999",
                          transform: "rotate(-45deg)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {dateStr}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Status Distribution */}
        <div
          style={{
            backgroundColor: "#fff",
            borderRadius: 8,
            padding: 24,
            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          }}
        >
          <h2 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600 }}>
            Order Status Distribution
          </h2>
          {statusDistribution.length === 0 ? (
            <p style={{ color: "#999", fontSize: 14 }}>No orders yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {statusDistribution
                .sort((a, b) => b.count - a.count)
                .map((s) => {
                  const pct = ((s.count / totalStatusCount) * 100).toFixed(1);
                  return (
                    <div key={s.status}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 13,
                          marginBottom: 4,
                        }}
                      >
                        <span style={{ fontWeight: 500 }}>{s.status.replace(/_/g, " ")}</span>
                        <span style={{ color: "#666" }}>
                          {s.count} ({pct}%)
                        </span>
                      </div>
                      <div
                        style={{
                          height: 8,
                          backgroundColor: "#f0f0f0",
                          borderRadius: 4,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${pct}%`,
                            backgroundColor: STATUS_COLORS[s.status] || "#b2bec3",
                            borderRadius: 4,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>

      {/* Top Products */}
      <div
        style={{
          backgroundColor: "#fff",
          borderRadius: 8,
          padding: 24,
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        }}
      >
        <h2 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600 }}>
          Top Products ({days}d)
        </h2>
        {topProducts.length === 0 ? (
          <p style={{ color: "#999", fontSize: 14 }}>No product data for this period.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #eee", textAlign: "left" }}>
                <th style={{ padding: "8px 12px", fontWeight: 600, color: "#333" }}>#</th>
                <th style={{ padding: "8px 12px", fontWeight: 600, color: "#333" }}>SKU</th>
                <th style={{ padding: "8px 12px", fontWeight: 600, color: "#333" }}>Product</th>
                <th style={{ padding: "8px 12px", fontWeight: 600, color: "#333" }}>Category</th>
                <th style={{ padding: "8px 12px", fontWeight: 600, color: "#333", textAlign: "right" }}>
                  Qty Ordered
                </th>
                <th style={{ padding: "8px 12px", fontWeight: 600, color: "#333", textAlign: "right" }}>
                  Orders
                </th>
              </tr>
            </thead>
            <tbody>
              {topProducts.map((tp, i) => (
                <tr
                  key={tp.product?.id || i}
                  style={{ borderBottom: "1px solid #f0f0f0" }}
                >
                  <td style={{ padding: "10px 12px", color: "#999" }}>{i + 1}</td>
                  <td style={{ padding: "10px 12px", fontFamily: "monospace", fontSize: 13 }}>
                    {tp.product?.sku || "-"}
                  </td>
                  <td style={{ padding: "10px 12px" }}>{tp.product?.title || "Unknown"}</td>
                  <td style={{ padding: "10px 12px", color: "#666" }}>
                    {tp.product?.category || "-"}
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600 }}>
                    {tp.totalQuantity}
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: "#666" }}>
                    {tp.orderCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
