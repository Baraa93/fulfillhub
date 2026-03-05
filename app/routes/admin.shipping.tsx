import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { requireAdmin } from "~/admin.server";
import { prisma } from "~/db.server";
import { createShipment } from "~/services/shipping.server";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdmin(request);
  const url = new URL(request.url);
  const view = url.searchParams.get("view") || "ready"; // ready | shipped | all

  // Ready to ship = PACKED orders
  const readyOrders = await prisma.order.findMany({
    where: { status: "PACKED" },
    include: {
      seller: { select: { shopName: true } },
      lineItems: { select: { title: true, quantity: true, sku: true } },
    },
    orderBy: { packedAt: "asc" },
  });

  // Recent shipments
  const recentShipments = await prisma.shipment.findMany({
    include: {
      order: {
        select: {
          shopifyOrderName: true,
          shopifyOrderNumber: true,
          customerName: true,
          shippingCountry: true,
          seller: { select: { shopName: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return json({
    readyOrders: readyOrders.map((o) => ({
      ...o,
      totalAmountUsd: Number(o.totalAmountUsd),
    })),
    recentShipments: recentShipments.map((s) => ({
      ...s,
      weightKg: s.weightKg ? Number(s.weightKg) : null,
    })),
    view,
    readyCount: readyOrders.length,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const admin = await requireAdmin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create_shipment") {
    const orderId = formData.get("orderId") as string;
    const carrier = formData.get("carrier") as "ARAMEX" | "SMSA" | undefined;
    const manualTracking = formData.get("manualTracking") as string | undefined;

    try {
      const shipment = await createShipment({
        orderId,
        carrier: carrier || undefined,
        manualTrackingNumber: manualTracking || undefined,
        adminUserId: admin.id,
      });
      return json({ success: true, message: `Shipment created. Tracking: ${shipment.trackingNumber || "pending"}` });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Failed to create shipment" }, { status: 400 });
    }
  }

  if (intent === "bulk_ship") {
    const orderIds = formData.getAll("orderIds") as string[];
    const results: { orderId: string; success: boolean; message: string }[] = [];

    for (const orderId of orderIds) {
      try {
        const shipment = await createShipment({
          orderId,
          adminUserId: admin.id,
        });
        results.push({ orderId, success: true, message: `Tracking: ${shipment.trackingNumber || "pending"}` });
      } catch (error) {
        results.push({ orderId, success: false, message: error instanceof Error ? error.message : "Failed" });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    return json({
      success: true,
      message: `${successCount}/${orderIds.length} shipments created successfully`,
      results,
    });
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

export default function AdminShipping() {
  const { readyOrders, recentShipments, view, readyCount } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [shipOrderId, setShipOrderId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === readyOrders.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(readyOrders.map((o) => o.id)));
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Shipping</h1>
      </div>

      {actionData && "error" in actionData && (
        <div style={errorBanner}>{actionData.error}</div>
      )}
      {actionData && "message" in actionData && (
        <div style={successBanner}>{actionData.message}</div>
      )}

      {/* View tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <Link to="/admin/shipping?view=ready" style={{ ...tabStyle, backgroundColor: view === "ready" ? "#6c5ce7" : "#fff", color: view === "ready" ? "#fff" : "#374151" }}>
          Ready to Ship ({readyCount})
        </Link>
        <Link to="/admin/shipping?view=shipped" style={{ ...tabStyle, backgroundColor: view === "shipped" ? "#6c5ce7" : "#fff", color: view === "shipped" ? "#fff" : "#374151" }}>
          Recent Shipments
        </Link>
      </div>

      {/* Ready to Ship */}
      {view === "ready" && (
        <>
          {/* Bulk ship button */}
          {selectedIds.size > 0 && (
            <Form method="post" style={{ marginBottom: 16 }}>
              <input type="hidden" name="intent" value="bulk_ship" />
              {Array.from(selectedIds).map((id) => (
                <input key={id} type="hidden" name="orderIds" value={id} />
              ))}
              <button
                type="submit"
                disabled={navigation.state === "submitting"}
                style={btnPrimary}
                onClick={(e) => {
                  if (!confirm(`Create shipments for ${selectedIds.size} orders?`)) e.preventDefault();
                }}
              >
                Ship Selected ({selectedIds.size})
              </button>
            </Form>
          )}

          <div style={cardStyle}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={thStyle}>
                    <input
                      type="checkbox"
                      checked={selectedIds.size === readyOrders.length && readyOrders.length > 0}
                      onChange={toggleAll}
                    />
                  </th>
                  <th style={thStyle}>Order</th>
                  <th style={thStyle}>Seller</th>
                  <th style={thStyle}>Customer</th>
                  <th style={thStyle}>Country</th>
                  <th style={thStyle}>Items</th>
                  <th style={thStyle}>Amount</th>
                  <th style={thStyle}>Packed</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {readyOrders.length === 0 && (
                  <tr><td colSpan={9} style={{ padding: 32, textAlign: "center", color: "#999" }}>No orders ready to ship.</td></tr>
                )}
                {readyOrders.map((order) => (
                  <tr key={order.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={tdStyle}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(order.id)}
                        onChange={() => toggleSelect(order.id)}
                      />
                    </td>
                    <td style={tdStyle}>
                      <Link to={`/admin/orders/${order.id}`} style={{ color: "#6c5ce7", textDecoration: "none", fontWeight: 600 }}>
                        {order.shopifyOrderName || order.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td style={tdStyle}>{order.seller?.shopName || "—"}</td>
                    <td style={tdStyle}>{order.customerName || "—"}</td>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 600 }}>{order.shippingCountry || "—"}</span>
                    </td>
                    <td style={tdStyle}>
                      {order.lineItems.map((li, i) => (
                        <div key={i} style={{ fontSize: 12 }}>{li.quantity}x {li.sku || li.title}</div>
                      ))}
                    </td>
                    <td style={tdStyle}>${order.totalAmountUsd.toFixed(2)}</td>
                    <td style={tdStyle}>
                      {order.packedAt ? new Date(order.packedAt).toLocaleDateString() : "—"}
                    </td>
                    <td style={tdStyle}>
                      <button onClick={() => setShipOrderId(order.id)} style={actionBtnStyle}>
                        Ship
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Ship form modal */}
          {shipOrderId && (
            <div style={{ ...cardStyle, marginTop: 16, border: "2px solid #6c5ce7" }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>
                Create Shipment — {readyOrders.find((o) => o.id === shipOrderId)?.shopifyOrderName}
              </h3>
              <Form method="post" onSubmit={() => setShipOrderId(null)}>
                <input type="hidden" name="intent" value="create_shipment" />
                <input type="hidden" name="orderId" value={shipOrderId} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div>
                    <label style={labelStyle}>Carrier (auto-detected if empty)</label>
                    <select name="carrier" style={inputStyle}>
                      <option value="">Auto-detect by country</option>
                      <option value="ARAMEX">Aramex</option>
                      <option value="SMSA">SMSA</option>
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Manual Tracking (leave empty for API)</label>
                    <input name="manualTracking" placeholder="AWB123456789" style={inputStyle} />
                  </div>
                </div>
                <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
                  <button type="submit" disabled={navigation.state === "submitting"} style={btnPrimary}>Create Shipment</button>
                  <button type="button" onClick={() => setShipOrderId(null)} style={btnSecondary}>Cancel</button>
                </div>
              </Form>
            </div>
          )}
        </>
      )}

      {/* Recent Shipments */}
      {view === "shipped" && (
        <div style={cardStyle}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                <th style={thStyle}>Order</th>
                <th style={thStyle}>Carrier</th>
                <th style={thStyle}>Tracking</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Created Via</th>
                <th style={thStyle}>Customer</th>
                <th style={thStyle}>Country</th>
                <th style={thStyle}>Shipped</th>
              </tr>
            </thead>
            <tbody>
              {recentShipments.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 32, textAlign: "center", color: "#999" }}>No shipments yet.</td></tr>
              )}
              {recentShipments.map((s) => (
                <tr key={s.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={tdStyle}>
                    <Link to={`/admin/orders/${s.orderId}`} style={{ color: "#6c5ce7", textDecoration: "none", fontWeight: 600 }}>
                      {s.order?.shopifyOrderName || s.orderId.slice(0, 8)}
                    </Link>
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600,
                      backgroundColor: s.carrier === "ARAMEX" ? "#dbeafe" : "#fef3c7",
                      color: s.carrier === "ARAMEX" ? "#1d4ed8" : "#92400e",
                    }}>
                      {s.carrier}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    {s.trackingNumber ? (
                      <span style={{ fontFamily: "monospace", fontSize: 13 }}>{s.trackingNumber}</span>
                    ) : (
                      <span style={{ color: "#9ca3af" }}>pending</span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600,
                      backgroundColor: shipmentStatusColor(s.status).bg,
                      color: shipmentStatusColor(s.status).color,
                    }}>
                      {s.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ fontSize: 12, color: s.createdVia === "MANUAL" ? "#92400e" : "#6b7280" }}>
                      {s.createdVia}
                    </span>
                  </td>
                  <td style={tdStyle}>{s.order?.customerName || "—"}</td>
                  <td style={tdStyle}>{s.order?.shippingCountry || "—"}</td>
                  <td style={tdStyle}>
                    {s.shippedAt ? new Date(s.shippedAt).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function shipmentStatusColor(status: string) {
  const map: Record<string, { bg: string; color: string }> = {
    PENDING: { bg: "#f3f4f6", color: "#374151" },
    LABEL_CREATED: { bg: "#dbeafe", color: "#1d4ed8" },
    PICKED_UP: { bg: "#e0e7ff", color: "#3730a3" },
    IN_TRANSIT: { bg: "#cffafe", color: "#0e7490" },
    OUT_FOR_DELIVERY: { bg: "#fef3c7", color: "#92400e" },
    DELIVERED: { bg: "#dcfce7", color: "#166534" },
    EXCEPTION: { bg: "#fee2e2", color: "#991b1b" },
    RETURNED: { bg: "#fef2f2", color: "#dc2626" },
  };
  return map[status] || { bg: "#f3f4f6", color: "#374151" };
}

const cardStyle: React.CSSProperties = { backgroundColor: "#fff", borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", overflow: "hidden" };
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4, color: "#374151" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, boxSizing: "border-box" };
const thStyle: React.CSSProperties = { padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" };
const tdStyle: React.CSSProperties = { padding: "10px 14px" };
const btnPrimary: React.CSSProperties = { padding: "8px 16px", backgroundColor: "#6c5ce7", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 };
const btnSecondary: React.CSSProperties = { padding: "8px 16px", backgroundColor: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer", fontSize: 14 };
const actionBtnStyle: React.CSSProperties = { background: "none", border: "1px solid #6c5ce7", color: "#6c5ce7", cursor: "pointer", fontSize: 13, padding: "4px 12px", borderRadius: 4, fontWeight: 500 };
const tabStyle: React.CSSProperties = { padding: "8px 16px", borderRadius: 6, border: "1px solid #d1d5db", textDecoration: "none", fontSize: 14, fontWeight: 500 };
const errorBanner: React.CSSProperties = { padding: "10px 14px", backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#dc2626", fontSize: 14, marginBottom: 16 };
const successBanner: React.CSSProperties = { padding: "10px 14px", backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, color: "#16a34a", fontSize: 14, marginBottom: 16 };
