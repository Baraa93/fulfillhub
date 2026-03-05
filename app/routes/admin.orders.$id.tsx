import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { requireAdmin } from "~/admin.server";
import { prisma } from "~/db.server";
import { logAudit } from "~/services/audit.server";
import { updateOrderStatus } from "~/services/order.server";
import { createShipment } from "~/services/shipping.server";
import type { OrderStatus } from "@prisma/client";

// ─────────────────────────────────────────────
// Style constants
// ─────────────────────────────────────────────

const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4, color: "#374151" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, boxSizing: "border-box" };
const thStyle: React.CSSProperties = { padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" };
const tdStyle: React.CSSProperties = { padding: "10px 14px" };
const btnPrimary: React.CSSProperties = { padding: "8px 16px", backgroundColor: "#6c5ce7", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 };
const btnSecondary: React.CSSProperties = { padding: "8px 16px", backgroundColor: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer", fontSize: 14 };

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

const PIPELINE: OrderStatus[] = [
  "PENDING_PAYMENT",
  "PROCESSING",
  "PURCHASED",
  "ALLOCATED",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
];

const ALL_STATUSES: OrderStatus[] = [
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

// Valid forward transitions (plus EXCEPTION/CANCELLED from most states)
const STATUS_TRANSITIONS: Record<string, OrderStatus[]> = {
  PENDING_PAYMENT: ["PROCESSING", "CANCELLED", "EXCEPTION"],
  PROCESSING: ["PURCHASED", "CANCELLED", "EXCEPTION"],
  PURCHASED: ["ALLOCATED", "CANCELLED", "EXCEPTION"],
  ALLOCATED: ["PACKED", "CANCELLED", "EXCEPTION"],
  PACKED: ["SHIPPED", "CANCELLED", "EXCEPTION"],
  SHIPPED: ["DELIVERED", "EXCEPTION", "RETURNED"],
  DELIVERED: ["RETURNED"],
  EXCEPTION: ["PROCESSING", "CANCELLED"],
  CANCELLED: [],
  RETURNED: [],
};

// ─────────────────────────────────────────────
// Loader
// ─────────────────────────────────────────────

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request);

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: {
      seller: { select: { id: true, shopName: true, shopDomain: true } },
      lineItems: {
        include: {
          catalogProduct: { select: { id: true, sku: true, title: true } },
          catalogVariant: { select: { id: true, sku: true, title: true, priceUsd: true } },
        },
      },
      shipments: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!order) {
    throw new Response("Order not found", { status: 404 });
  }

  // Convert Decimal fields to Number for serialization
  const serializedOrder = {
    ...order,
    totalAmountUsd: Number(order.totalAmountUsd),
    lineItems: order.lineItems.map((li) => ({
      ...li,
      priceUsd: Number(li.priceUsd),
      costUsd: li.costUsd ? Number(li.costUsd) : null,
      catalogVariant: li.catalogVariant
        ? { ...li.catalogVariant, priceUsd: Number(li.catalogVariant.priceUsd) }
        : null,
    })),
    shipments: order.shipments.map((s) => ({
      ...s,
      weightKg: s.weightKg ? Number(s.weightKg) : null,
    })),
  };

  const allowedTransitions = STATUS_TRANSITIONS[order.status] || [];

  return json({ order: serializedOrder, allowedTransitions });
}

// ─────────────────────────────────────────────
// Action
// ─────────────────────────────────────────────

export async function action({ request, params }: ActionFunctionArgs) {
  const admin = await requireAdmin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  try {
    if (intent === "update_status") {
      const status = formData.get("status") as OrderStatus;
      const note = (formData.get("note") as string) || undefined;

      if (!status || !ALL_STATUSES.includes(status)) {
        return json({ error: "Invalid status value." }, { status: 400 });
      }

      await updateOrderStatus(params.id!, status, admin.id, "ADMIN", note);
      return json({ success: true, message: `Status updated to ${status}.` });
    }

    if (intent === "create_shipment") {
      const carrier = (formData.get("carrier") as string) || undefined;
      const manualTracking = (formData.get("manualTracking") as string) || undefined;

      const shipment = await createShipment({
        orderId: params.id!,
        carrier: carrier as "ARAMEX" | "SMSA" | undefined,
        manualTrackingNumber: manualTracking,
        adminUserId: admin.id,
      });

      return json({ success: true, message: `Shipment created. Tracking: ${shipment.trackingNumber || "pending"}` });
    }

    if (intent === "update_note") {
      const note = (formData.get("note") as string) || "";

      await prisma.order.update({
        where: { id: params.id! },
        data: { statusNote: note },
      });

      await logAudit({
        actorType: "ADMIN",
        actorId: admin.id,
        action: "order.note_updated",
        entityType: "Order",
        entityId: params.id!,
        details: { note },
      });

      return json({ success: true, message: "Note updated." });
    }

    return json({ error: "Unknown intent." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "An unexpected error occurred.";
    return json({ error: message }, { status: 400 });
  }
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function AdminOrderDetail() {
  const { order, allowedTransitions } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const statusColor = STATUS_COLORS[order.status] || { bg: "#f3f4f6", color: "#374151" };
  const canCreateShipment = ["PACKED", "ALLOCATED", "PURCHASED"].includes(order.status) && order.shipments.length === 0;

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const shippingAddress = [
    order.shippingAddress1,
    order.shippingAddress2,
    order.shippingCity,
    order.shippingProvince,
    order.shippingCountry,
    order.shippingZip,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1100, margin: "0 auto" }}>
      {/* Back link */}
      <Link
        to="/admin/orders"
        style={{ color: "#6c5ce7", textDecoration: "none", fontSize: 14, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 16 }}
      >
        &larr; Back to Orders
      </Link>

      {/* Action feedback */}
      {actionData && "error" in actionData && actionData.error && (
        <div style={{ padding: "10px 14px", backgroundColor: "#fee2e2", color: "#991b1b", borderRadius: 6, marginBottom: 16, fontSize: 14 }}>
          {actionData.error}
        </div>
      )}
      {actionData && "success" in actionData && actionData.success && (
        <div style={{ padding: "10px 14px", backgroundColor: "#dcfce7", color: "#166534", borderRadius: 6, marginBottom: 16, fontSize: 14 }}>
          {actionData.message}
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: "#111827" }}>
          {order.shopifyOrderName || `Order ${order.id.slice(0, 8)}`}
        </h1>
        <span
          style={{
            padding: "4px 12px",
            borderRadius: 9999,
            fontSize: 12,
            fontWeight: 600,
            backgroundColor: statusColor.bg,
            color: statusColor.color,
          }}
        >
          {order.status}
        </span>
        <span style={{ fontSize: 13, color: "#6b7280", marginLeft: "auto" }}>
          {formatDate(order.createdAt)}
        </span>
      </div>

      {/* Order info card */}
      <div style={{ backgroundColor: "#fff", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", padding: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginTop: 0, marginBottom: 16, color: "#111827" }}>Order Information</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 32px" }}>
          <div>
            <span style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", fontWeight: 600 }}>Seller</span>
            <p style={{ margin: "4px 0 0", fontSize: 14, color: "#111827" }}>
              {order.seller.shopName || order.seller.shopDomain}
              <span style={{ color: "#9ca3af", fontSize: 12, marginLeft: 6 }}>{order.seller.shopDomain}</span>
            </p>
          </div>
          <div>
            <span style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", fontWeight: 600 }}>Customer</span>
            <p style={{ margin: "4px 0 0", fontSize: 14, color: "#111827" }}>
              {order.customerName || "-"}
              {order.customerEmail && <span style={{ color: "#6b7280", fontSize: 12, marginLeft: 6 }}>{order.customerEmail}</span>}
            </p>
          </div>
          <div>
            <span style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", fontWeight: 600 }}>Shipping Address</span>
            <p style={{ margin: "4px 0 0", fontSize: 14, color: "#111827" }}>{shippingAddress || "-"}</p>
            {order.shippingPhone && <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6b7280" }}>Phone: {order.shippingPhone}</p>}
          </div>
          <div>
            <span style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", fontWeight: 600 }}>Financial</span>
            <p style={{ margin: "4px 0 0", fontSize: 14, color: "#111827" }}>
              Total: <strong>${order.totalAmountUsd.toFixed(2)}</strong>
              <span style={{ marginLeft: 12, fontSize: 12, color: order.walletDeducted ? "#166534" : "#92400e" }}>
                Wallet deducted: {order.walletDeducted ? "Yes" : "No"}
              </span>
            </p>
          </div>
          <div>
            <span style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", fontWeight: 600 }}>Carrier</span>
            <p style={{ margin: "4px 0 0", fontSize: 14, color: "#111827" }}>
              {order.assignedCarrier || "Not assigned"}
              {order.carrierOverride && <span style={{ fontSize: 11, color: "#6c5ce7", marginLeft: 6 }}>(override)</span>}
            </p>
          </div>
          <div>
            <span style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", fontWeight: 600 }}>Shopify Order ID</span>
            <p style={{ margin: "4px 0 0", fontSize: 14, color: "#111827" }}>{order.shopifyOrderId}</p>
          </div>
        </div>
      </div>

      {/* Status timeline */}
      <div style={{ backgroundColor: "#fff", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", padding: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginTop: 0, marginBottom: 20, color: "#111827" }}>Status Timeline</h2>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
          {/* Connecting line */}
          <div
            style={{
              position: "absolute",
              top: 14,
              left: 20,
              right: 20,
              height: 3,
              backgroundColor: "#e5e7eb",
              zIndex: 0,
            }}
          />
          {(() => {
            const currentIndex = PIPELINE.indexOf(order.status as OrderStatus);
            const isTerminal = ["EXCEPTION", "CANCELLED", "RETURNED"].includes(order.status);
            return PIPELINE.map((step, i) => {
              const isActive = step === order.status;
              const isPast = !isTerminal && currentIndex >= 0 && i < currentIndex;
              const isReached = isActive || isPast;
              return (
                <div key={step} style={{ display: "flex", flexDirection: "column", alignItems: "center", zIndex: 1, flex: 1 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      backgroundColor: isActive ? "#6c5ce7" : isPast ? "#a78bfa" : "#e5e7eb",
                      border: isActive ? "3px solid #6c5ce7" : isPast ? "3px solid #a78bfa" : "3px solid #d1d5db",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {isReached && (
                      <div style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: "#fff" }} />
                    )}
                  </div>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: isActive ? 700 : 500,
                      color: isActive ? "#6c5ce7" : isPast ? "#7c3aed" : "#9ca3af",
                      marginTop: 6,
                      textAlign: "center",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {step.replace("_", " ")}
                  </span>
                </div>
              );
            });
          })()}
        </div>
        {["EXCEPTION", "CANCELLED", "RETURNED"].includes(order.status) && (
          <div style={{ marginTop: 12, textAlign: "center" }}>
            <span
              style={{
                padding: "4px 12px",
                borderRadius: 9999,
                fontSize: 12,
                fontWeight: 600,
                backgroundColor: statusColor.bg,
                color: statusColor.color,
              }}
            >
              {order.status}
            </span>
          </div>
        )}
      </div>

      {/* Status update form */}
      {allowedTransitions.length > 0 && (
        <div style={{ backgroundColor: "#fff", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", padding: 24, marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginTop: 0, marginBottom: 16, color: "#111827" }}>Update Status</h2>
          <Form method="post">
            <input type="hidden" name="intent" value="update_status" />
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ flex: "0 0 200px" }}>
                <label style={labelStyle}>New Status</label>
                <select name="status" style={inputStyle} required>
                  <option value="">Select status...</option>
                  {allowedTransitions.map((s: string) => {
                    const sc = STATUS_COLORS[s] || { bg: "#f3f4f6", color: "#374151" };
                    return (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={labelStyle}>Note (optional)</label>
                <input type="text" name="note" placeholder="e.g. OOS variant, address issue..." style={inputStyle} />
              </div>
              <button type="submit" style={btnPrimary} disabled={isSubmitting}>
                {isSubmitting ? "Updating..." : "Update Status"}
              </button>
            </div>
          </Form>
        </div>
      )}

      {/* Line items table */}
      <div style={{ backgroundColor: "#fff", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", padding: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginTop: 0, marginBottom: 16, color: "#111827" }}>
          Line Items ({order.lineItems.length})
        </h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                <th style={thStyle}>SKU</th>
                <th style={thStyle}>Title</th>
                <th style={thStyle}>Variant</th>
                <th style={thStyle}>Qty</th>
                <th style={thStyle}>Unit Price</th>
                <th style={thStyle}>Cost</th>
                <th style={thStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {order.lineItems.map((li: any) => {
                const liStatusColor = STATUS_COLORS[li.status] || { bg: "#f3f4f6", color: "#374151" };
                return (
                  <tr key={li.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 13 }}>{li.sku || "-"}</td>
                    <td style={tdStyle}>{li.title}</td>
                    <td style={{ ...tdStyle, color: "#6b7280", fontSize: 13 }}>{li.variantTitle || "-"}</td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>{li.quantity}</td>
                    <td style={tdStyle}>${li.priceUsd.toFixed(2)}</td>
                    <td style={tdStyle}>{li.costUsd != null ? `$${li.costUsd.toFixed(2)}` : "-"}</td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          padding: "3px 8px",
                          borderRadius: 9999,
                          fontSize: 11,
                          fontWeight: 600,
                          backgroundColor: liStatusColor.bg,
                          color: liStatusColor.color,
                        }}
                      >
                        {li.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Shipments section */}
      <div style={{ backgroundColor: "#fff", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", padding: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginTop: 0, marginBottom: 16, color: "#111827" }}>
          Shipments ({order.shipments.length})
        </h2>

        {order.shipments.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {order.shipments.map((shipment: any) => {
              const shipStatusColor = STATUS_COLORS[shipment.status] || { bg: "#dbeafe", color: "#1d4ed8" };
              return (
                <div
                  key={shipment.id}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                    padding: 16,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                    <span
                      style={{
                        padding: "3px 10px",
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 700,
                        backgroundColor: shipment.carrier === "ARAMEX" ? "#fef3c7" : "#dbeafe",
                        color: shipment.carrier === "ARAMEX" ? "#92400e" : "#1d4ed8",
                      }}
                    >
                      {shipment.carrier}
                    </span>
                    <span style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 600 }}>
                      {shipment.trackingNumber || "No tracking"}
                    </span>
                    <span
                      style={{
                        padding: "3px 8px",
                        borderRadius: 9999,
                        fontSize: 11,
                        fontWeight: 600,
                        backgroundColor: shipStatusColor.bg,
                        color: shipStatusColor.color,
                      }}
                    >
                      {shipment.status}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: "#9ca3af",
                        padding: "2px 8px",
                        backgroundColor: "#f9fafb",
                        borderRadius: 4,
                      }}
                    >
                      {shipment.createdVia}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 24, fontSize: 13, color: "#6b7280" }}>
                    <span>Created: {formatDate(shipment.createdAt)}</span>
                    {shipment.shippedAt && <span>Shipped: {formatDate(shipment.shippedAt)}</span>}
                    {shipment.deliveredAt && <span>Delivered: {formatDate(shipment.deliveredAt)}</span>}
                    {shipment.estimatedDelivery && <span>ETA: {formatDate(shipment.estimatedDelivery)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : canCreateShipment ? (
          <div>
            <p style={{ fontSize: 14, color: "#6b7280", marginTop: 0, marginBottom: 16 }}>
              No shipments yet. Create one below.
            </p>
            <Form method="post">
              <input type="hidden" name="intent" value="create_shipment" />
              <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div style={{ flex: "0 0 180px" }}>
                  <label style={labelStyle}>Carrier</label>
                  <select name="carrier" style={inputStyle}>
                    <option value="">Auto-detect</option>
                    <option value="ARAMEX">ARAMEX</option>
                    <option value="SMSA">SMSA</option>
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label style={labelStyle}>Manual Tracking Number (optional)</label>
                  <input type="text" name="manualTracking" placeholder="Leave empty for API creation" style={inputStyle} />
                </div>
                <button type="submit" style={btnPrimary} disabled={isSubmitting}>
                  {isSubmitting ? "Creating..." : "Create Shipment"}
                </button>
              </div>
            </Form>
          </div>
        ) : (
          <p style={{ fontSize: 14, color: "#9ca3af", margin: 0 }}>No shipments.</p>
        )}
      </div>

      {/* Notes section */}
      <div style={{ backgroundColor: "#fff", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", padding: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginTop: 0, marginBottom: 16, color: "#111827" }}>Notes</h2>
        {order.statusNote && (
          <div style={{ padding: "10px 14px", backgroundColor: "#f9fafb", borderRadius: 6, marginBottom: 16, fontSize: 14, color: "#374151", borderLeft: "3px solid #6c5ce7" }}>
            {order.statusNote}
          </div>
        )}
        <Form method="post">
          <input type="hidden" name="intent" value="update_note" />
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Status Note</label>
              <input
                type="text"
                name="note"
                defaultValue={order.statusNote || ""}
                placeholder="Add a note about this order..."
                style={inputStyle}
              />
            </div>
            <button type="submit" style={btnSecondary} disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Update Note"}
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}
