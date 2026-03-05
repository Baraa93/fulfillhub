import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { requireAdmin } from "~/admin.server";
import { prisma } from "~/db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdmin(request);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [ordersToday, pendingPacking, shippedToday, totalSellers, activeRules] =
    await Promise.all([
      prisma.order.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.order.count({ where: { status: "ALLOCATED" } }),
      prisma.order.count({
        where: { status: "SHIPPED", updatedAt: { gte: todayStart } },
      }),
      prisma.seller.count({ where: { status: "ACTIVE" } }),
      prisma.shippingRule.count({ where: { isActive: true } }),
    ]);

  return json({ ordersToday, pendingPacking, shippedToday, totalSellers, activeRules });
};

export default function AdminDashboard() {
  const stats = useLoaderData<typeof loader>();

  const cards = [
    { label: "Orders Today", value: stats.ordersToday, color: "#6c5ce7" },
    { label: "Pending Packing", value: stats.pendingPacking, color: "#e17055" },
    { label: "Shipped Today", value: stats.shippedToday, color: "#00b894" },
    { label: "Active Sellers", value: stats.totalSellers, color: "#0984e3" },
    { label: "Shipping Rules", value: stats.activeRules, color: "#fdcb6e" },
  ];

  return (
    <div>
      <h1 style={{ margin: "0 0 24px", fontSize: 24, fontWeight: 700 }}>Dashboard</h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
        {cards.map((card) => (
          <div
            key={card.label}
            style={{
              backgroundColor: "#fff",
              borderRadius: 8,
              padding: 20,
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
              borderLeft: `4px solid ${card.color}`,
            }}
          >
            <p style={{ margin: 0, fontSize: 13, color: "#666" }}>{card.label}</p>
            <p style={{ margin: "8px 0 0", fontSize: 28, fontWeight: 700 }}>{card.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
