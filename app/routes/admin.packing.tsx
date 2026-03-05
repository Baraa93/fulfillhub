import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { requireAdmin } from "~/admin.server";
import { prisma } from "~/db.server";
import { updateOrderStatus } from "~/services/order.server";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdmin(request);
  const url = new URL(request.url);
  const view = url.searchParams.get("view") || "to_pack"; // to_pack | packed | pick_list

  let statusFilter: string[];
  if (view === "packed") {
    statusFilter = ["PACKED"];
  } else {
    statusFilter = ["PROCESSING", "PURCHASED", "ALLOCATED"];
  }

  const orders = await prisma.order.findMany({
    where: { status: { in: statusFilter as any } },
    include: {
      seller: { select: { shopName: true, brandedPackaging: true, packagingInsert: true, packagingNotes: true } },
      lineItems: {
        include: {
          catalogProduct: { select: { sku: true, title: true, images: true } },
          catalogVariant: { select: { sku: true, title: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const counts = await prisma.order.groupBy({
    by: ["status"],
    where: { status: { in: ["PROCESSING", "PURCHASED", "ALLOCATED", "PACKED"] } },
    _count: true,
  });

  const countsMap: Record<string, number> = {};
  for (const c of counts) countsMap[c.status] = c._count;

  return json({
    orders: orders.map((o) => ({
      ...o,
      totalAmountUsd: Number(o.totalAmountUsd),
      lineItems: o.lineItems.map((li) => ({
        ...li,
        priceUsd: Number(li.priceUsd),
        costUsd: li.costUsd ? Number(li.costUsd) : null,
      })),
    })),
    view,
    counts: countsMap,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const admin = await requireAdmin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "mark_packed") {
    const orderId = formData.get("orderId") as string;
    await updateOrderStatus(orderId, "PACKED", admin.id, "ADMIN", "Packed by warehouse");
    return json({ success: true, message: "Order marked as packed" });
  }

  if (intent === "mark_allocated") {
    const orderId = formData.get("orderId") as string;
    await updateOrderStatus(orderId, "ALLOCATED", admin.id, "ADMIN", "Stock allocated");
    return json({ success: true, message: "Order marked as allocated" });
  }

  if (intent === "mark_exception") {
    const orderId = formData.get("orderId") as string;
    const note = formData.get("note") as string;
    await updateOrderStatus(orderId, "EXCEPTION", admin.id, "ADMIN", note || "Exception flagged during packing");
    return json({ success: true, message: "Order flagged as exception" });
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

export default function AdminPacking() {
  const { orders, view, counts } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [exceptionOrderId, setExceptionOrderId] = useState<string | null>(null);

  const toPackCount = (counts["PROCESSING"] || 0) + (counts["PURCHASED"] || 0) + (counts["ALLOCATED"] || 0);
  const packedCount = counts["PACKED"] || 0;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Packing Workflow</h1>
      </div>

      {actionData && "error" in actionData && (
        <div style={errorBanner}>{actionData.error}</div>
      )}
      {actionData && "message" in actionData && (
        <div style={successBanner}>{actionData.message}</div>
      )}

      {/* View tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <Link
          to="/admin/packing?view=to_pack"
          style={{
            ...tabStyle,
            backgroundColor: view === "to_pack" ? "#6c5ce7" : "#fff",
            color: view === "to_pack" ? "#fff" : "#374151",
          }}
        >
          To Pack ({toPackCount})
        </Link>
        <Link
          to="/admin/packing?view=packed"
          style={{
            ...tabStyle,
            backgroundColor: view === "packed" ? "#6c5ce7" : "#fff",
            color: view === "packed" ? "#fff" : "#374151",
          }}
        >
          Packed ({packedCount})
        </Link>
        <Link
          to="/admin/packing?view=pick_list"
          style={{
            ...tabStyle,
            backgroundColor: view === "pick_list" ? "#6c5ce7" : "#fff",
            color: view === "pick_list" ? "#fff" : "#374151",
          }}
        >
          Pick List
        </Link>
      </div>

      {/* Pick List view: aggregated items */}
      {view === "pick_list" && (
        <div style={cardStyle}>
          <h2 style={{ margin: "0 0 16px", fontSize: 16 }}>Pick List — Items to Collect</h2>
          <PickList orders={orders} />
        </div>
      )}

      {/* Orders cards */}
      {view !== "pick_list" && (
        <>
          {orders.length === 0 && (
            <div style={{ ...cardStyle, textAlign: "center", color: "#999", padding: 48 }}>
              {view === "packed" ? "No packed orders waiting for shipment." : "No orders waiting to be packed."}
            </div>
          )}
          {orders.map((order) => (
            <div key={order.id} style={{ ...cardStyle, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 12 }}>
                <div>
                  <Link to={`/admin/orders/${order.id}`} style={{ fontSize: 16, fontWeight: 700, color: "#6c5ce7", textDecoration: "none" }}>
                    {order.shopifyOrderName || order.id.slice(0, 8)}
                  </Link>
                  <span style={{ ...statusBadge(order.status), marginLeft: 8 }}>{order.status.replace(/_/g, " ")}</span>
                  <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
                    {order.seller?.shopName} — {order.customerName} — {order.shippingCity}, {order.shippingCountry}
                  </div>
                </div>
                <div style={{ textAlign: "right", fontSize: 13, color: "#6b7280" }}>
                  {new Date(order.createdAt).toLocaleDateString()}
                </div>
              </div>

              {/* Packaging info */}
              {(order.seller?.brandedPackaging || order.seller?.packagingInsert) && (
                <div style={{ padding: "8px 12px", backgroundColor: "#fef3c7", borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
                  <strong>Packaging:</strong>{" "}
                  {order.seller.brandedPackaging && "Branded packaging. "}
                  {order.seller.packagingInsert && `Insert: "${order.seller.packagingInsert}". `}
                  {order.seller.packagingNotes && order.seller.packagingNotes}
                </div>
              )}

              {/* Line items */}
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                    <th style={{ ...thStyle, padding: "6px 10px" }}>SKU</th>
                    <th style={{ ...thStyle, padding: "6px 10px" }}>Item</th>
                    <th style={{ ...thStyle, padding: "6px 10px" }}>Variant</th>
                    <th style={{ ...thStyle, padding: "6px 10px" }}>Qty</th>
                    <th style={{ ...thStyle, padding: "6px 10px" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lineItems.map((li) => (
                    <tr key={li.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "6px 10px", fontFamily: "monospace", fontSize: 12 }}>
                        {li.catalogVariant?.sku || li.catalogProduct?.sku || li.sku || "—"}
                      </td>
                      <td style={{ padding: "6px 10px" }}>{li.title}</td>
                      <td style={{ padding: "6px 10px" }}>{li.variantTitle || "—"}</td>
                      <td style={{ padding: "6px 10px", fontWeight: 600 }}>{li.quantity}</td>
                      <td style={{ padding: "6px 10px" }}>
                        <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 3, backgroundColor: "#f3f4f6" }}>{li.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Actions */}
              {view === "to_pack" && (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {order.status === "PROCESSING" && (
                    <Form method="post" style={{ display: "inline" }}>
                      <input type="hidden" name="intent" value="mark_allocated" />
                      <input type="hidden" name="orderId" value={order.id} />
                      <button type="submit" disabled={navigation.state === "submitting"} style={btnSecondary}>
                        Mark Allocated
                      </button>
                    </Form>
                  )}
                  <Form method="post" style={{ display: "inline" }}>
                    <input type="hidden" name="intent" value="mark_packed" />
                    <input type="hidden" name="orderId" value={order.id} />
                    <button type="submit" disabled={navigation.state === "submitting"} style={btnPrimary}>
                      Mark Packed
                    </button>
                  </Form>
                  <button onClick={() => setExceptionOrderId(order.id)} style={{ ...actionBtn, color: "#dc2626" }}>
                    Flag Exception
                  </button>
                </div>
              )}

              {/* Exception form */}
              {exceptionOrderId === order.id && (
                <Form method="post" style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "end" }}>
                  <input type="hidden" name="intent" value="mark_exception" />
                  <input type="hidden" name="orderId" value={order.id} />
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Exception Reason</label>
                    <input name="note" required placeholder="e.g., OOS: variant FH-TWL-001-WH-L" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                  </div>
                  <button type="submit" style={{ ...btnPrimary, backgroundColor: "#dc2626" }}>Confirm</button>
                  <button type="button" onClick={() => setExceptionOrderId(null)} style={btnSecondary}>Cancel</button>
                </Form>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function PickList({ orders }: { orders: any[] }) {
  const itemMap = new Map<string, { sku: string; title: string; variant: string; totalQty: number; orderRefs: string[] }>();

  for (const order of orders) {
    for (const li of order.lineItems) {
      const sku = li.catalogVariant?.sku || li.catalogProduct?.sku || li.sku || "UNKNOWN";
      const key = sku;
      const existing = itemMap.get(key);
      const orderRef = order.shopifyOrderName || order.id.slice(0, 8);
      if (existing) {
        existing.totalQty += li.quantity;
        if (!existing.orderRefs.includes(orderRef)) existing.orderRefs.push(orderRef);
      } else {
        itemMap.set(key, {
          sku,
          title: li.title,
          variant: li.variantTitle || "",
          totalQty: li.quantity,
          orderRefs: [orderRef],
        });
      }
    }
  }

  const items = Array.from(itemMap.values()).sort((a, b) => a.sku.localeCompare(b.sku));

  if (items.length === 0) {
    return <p style={{ color: "#999", textAlign: "center" }}>No items to pick.</p>;
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
      <thead>
        <tr style={{ backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
          <th style={thStyle}>SKU</th>
          <th style={thStyle}>Item</th>
          <th style={thStyle}>Variant</th>
          <th style={thStyle}>Total Qty</th>
          <th style={thStyle}>Orders</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.sku} style={{ borderBottom: "1px solid #f0f0f0" }}>
            <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 13 }}>{item.sku}</td>
            <td style={tdStyle}>{item.title}</td>
            <td style={tdStyle}>{item.variant || "—"}</td>
            <td style={{ ...tdStyle, fontWeight: 700, fontSize: 16 }}>{item.totalQty}</td>
            <td style={{ ...tdStyle, fontSize: 12, color: "#6b7280" }}>{item.orderRefs.join(", ")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function statusBadge(status: string): React.CSSProperties {
  const colors: Record<string, { bg: string; color: string }> = {
    PROCESSING: { bg: "#dbeafe", color: "#1d4ed8" },
    PURCHASED: { bg: "#e0e7ff", color: "#3730a3" },
    ALLOCATED: { bg: "#ede9fe", color: "#5b21b6" },
    PACKED: { bg: "#fce7f3", color: "#9d174d" },
  };
  const c = colors[status] || { bg: "#f3f4f6", color: "#374151" };
  return { padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600, backgroundColor: c.bg, color: c.color, display: "inline-block" };
}

const cardStyle: React.CSSProperties = { backgroundColor: "#fff", borderRadius: 8, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" };
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4, color: "#374151" };
const inputStyle: React.CSSProperties = { padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 };
const thStyle: React.CSSProperties = { padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" };
const tdStyle: React.CSSProperties = { padding: "10px 14px" };
const btnPrimary: React.CSSProperties = { padding: "8px 16px", backgroundColor: "#6c5ce7", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 };
const btnSecondary: React.CSSProperties = { padding: "8px 16px", backgroundColor: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer", fontSize: 14 };
const actionBtn: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", fontSize: 13, padding: "2px 6px" };
const tabStyle: React.CSSProperties = { padding: "8px 16px", borderRadius: 6, border: "1px solid #d1d5db", textDecoration: "none", fontSize: 14, fontWeight: 500 };
const errorBanner: React.CSSProperties = { padding: "10px 14px", backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#dc2626", fontSize: 14, marginBottom: 16 };
const successBanner: React.CSSProperties = { padding: "10px 14px", backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, color: "#16a34a", fontSize: 14, marginBottom: 16 };
