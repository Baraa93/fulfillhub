import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { requireAdmin } from "~/admin.server";
import { prisma } from "~/db.server";
import { logAudit } from "~/services/audit.server";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdmin(request);
  const rules = await prisma.shippingRule.findMany({ orderBy: { country: "asc" } });
  return json({
    rules: rules.map((r) => ({
      ...r,
      maxWeightKg: r.maxWeightKg ? Number(r.maxWeightKg) : null,
      baseCostUsd: r.baseCostUsd ? Number(r.baseCostUsd) : null,
      perKgCostUsd: r.perKgCostUsd ? Number(r.perKgCostUsd) : null,
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const admin = await requireAdmin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create" || intent === "update") {
    const id = formData.get("id") as string | null;
    const country = (formData.get("country") as string)?.toUpperCase().trim();
    const defaultCarrier = formData.get("defaultCarrier") as "ARAMEX" | "SMSA";
    const baseCostUsd = formData.get("baseCostUsd") ? Number(formData.get("baseCostUsd")) : null;
    const perKgCostUsd = formData.get("perKgCostUsd") ? Number(formData.get("perKgCostUsd")) : null;
    const maxWeightKg = formData.get("maxWeightKg") ? Number(formData.get("maxWeightKg")) : null;
    const estimatedDays = formData.get("estimatedDays") ? Number(formData.get("estimatedDays")) : null;

    if (!country || country.length !== 2) {
      return json({ error: "Country must be a 2-letter ISO code" }, { status: 400 });
    }

    const data = { country, defaultCarrier, baseCostUsd, perKgCostUsd, maxWeightKg, estimatedDays };

    if (intent === "update" && id) {
      await prisma.shippingRule.update({ where: { id }, data });
      await logAudit({
        actorType: "ADMIN",
        actorId: admin.id,
        action: "shipping_rule.updated",
        entityType: "ShippingRule",
        entityId: id,
        details: data,
      });
      return json({ success: true, message: `Rule for ${country} updated` });
    } else {
      const rule = await prisma.shippingRule.create({ data });
      await logAudit({
        actorType: "ADMIN",
        actorId: admin.id,
        action: "shipping_rule.created",
        entityType: "ShippingRule",
        entityId: rule.id,
        details: data,
      });
      return json({ success: true, message: `Rule for ${country} created` });
    }
  }

  if (intent === "toggle") {
    const id = formData.get("id") as string;
    const rule = await prisma.shippingRule.findUnique({ where: { id } });
    if (!rule) return json({ error: "Rule not found" }, { status: 404 });

    await prisma.shippingRule.update({ where: { id }, data: { isActive: !rule.isActive } });
    await logAudit({
      actorType: "ADMIN",
      actorId: admin.id,
      action: rule.isActive ? "shipping_rule.deactivated" : "shipping_rule.activated",
      entityType: "ShippingRule",
      entityId: id,
    });
    return json({ success: true });
  }

  if (intent === "delete") {
    const id = formData.get("id") as string;
    await prisma.shippingRule.delete({ where: { id } });
    await logAudit({
      actorType: "ADMIN",
      actorId: admin.id,
      action: "shipping_rule.deleted",
      entityType: "ShippingRule",
      entityId: id,
    });
    return json({ success: true, message: "Rule deleted" });
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

export default function ShippingRules() {
  const { rules } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editingRule = editingId ? rules.find((r) => r.id === editingId) : null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Shipping Rules</h1>
        <button
          onClick={() => { setShowForm(true); setEditingId(null); }}
          style={{
            padding: "8px 16px",
            backgroundColor: "#6c5ce7",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          Add Rule
        </button>
      </div>

      {actionData && "error" in actionData && (
        <div style={{ padding: "10px 14px", backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#dc2626", fontSize: 14, marginBottom: 16 }}>
          {actionData.error}
        </div>
      )}
      {actionData && "message" in actionData && (
        <div style={{ padding: "10px 14px", backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, color: "#16a34a", fontSize: 14, marginBottom: 16 }}>
          {actionData.message}
        </div>
      )}

      {/* Add/Edit Form */}
      {(showForm || editingId) && (
        <div style={{ backgroundColor: "#fff", borderRadius: 8, padding: 24, marginBottom: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
          <h2 style={{ margin: "0 0 16px", fontSize: 16 }}>{editingId ? "Edit Rule" : "Add Rule"}</h2>
          <Form method="post" onSubmit={() => { setShowForm(false); setEditingId(null); }}>
            <input type="hidden" name="intent" value={editingId ? "update" : "create"} />
            {editingId && <input type="hidden" name="id" value={editingId} />}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
              <div>
                <label style={labelStyle}>Country (ISO 2-letter)</label>
                <input name="country" defaultValue={editingRule?.country || ""} required maxLength={2} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Default Carrier</label>
                <select name="defaultCarrier" defaultValue={editingRule?.defaultCarrier || "ARAMEX"} style={inputStyle}>
                  <option value="ARAMEX">Aramex</option>
                  <option value="SMSA">SMSA</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Estimated Days</label>
                <input name="estimatedDays" type="number" defaultValue={editingRule?.estimatedDays ?? ""} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Base Cost (USD)</label>
                <input name="baseCostUsd" type="number" step="0.01" defaultValue={editingRule?.baseCostUsd ?? ""} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Per KG Cost (USD)</label>
                <input name="perKgCostUsd" type="number" step="0.01" defaultValue={editingRule?.perKgCostUsd ?? ""} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Max Weight (KG)</label>
                <input name="maxWeightKg" type="number" step="0.001" defaultValue={editingRule?.maxWeightKg ?? ""} style={inputStyle} />
              </div>
            </div>
            <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <button type="submit" disabled={navigation.state === "submitting"} style={{ ...btnPrimary }}>
                {editingId ? "Update" : "Create"}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setEditingId(null); }} style={btnSecondary}>
                Cancel
              </button>
            </div>
          </Form>
        </div>
      )}

      {/* Rules Table */}
      <div style={{ backgroundColor: "#fff", borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
              <th style={thStyle}>Country</th>
              <th style={thStyle}>Carrier</th>
              <th style={thStyle}>Base Cost</th>
              <th style={thStyle}>Per KG</th>
              <th style={thStyle}>Max Weight</th>
              <th style={thStyle}>Est. Days</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: 24, textAlign: "center", color: "#999" }}>
                  No shipping rules yet. Click "Add Rule" to create one.
                </td>
              </tr>
            )}
            {rules.map((rule) => (
              <tr key={rule.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={tdStyle}><strong>{rule.country}</strong></td>
                <td style={tdStyle}>
                  <span style={{
                    padding: "2px 8px",
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: 600,
                    backgroundColor: rule.defaultCarrier === "ARAMEX" ? "#dbeafe" : "#fef3c7",
                    color: rule.defaultCarrier === "ARAMEX" ? "#1d4ed8" : "#92400e",
                  }}>
                    {rule.defaultCarrier}
                  </span>
                </td>
                <td style={tdStyle}>{rule.baseCostUsd != null ? `$${rule.baseCostUsd.toFixed(2)}` : "—"}</td>
                <td style={tdStyle}>{rule.perKgCostUsd != null ? `$${rule.perKgCostUsd.toFixed(2)}` : "—"}</td>
                <td style={tdStyle}>{rule.maxWeightKg != null ? `${rule.maxWeightKg} kg` : "—"}</td>
                <td style={tdStyle}>{rule.estimatedDays ?? "—"}</td>
                <td style={tdStyle}>
                  <span style={{
                    padding: "2px 8px",
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: 600,
                    backgroundColor: rule.isActive ? "#dcfce7" : "#fee2e2",
                    color: rule.isActive ? "#166534" : "#991b1b",
                  }}>
                    {rule.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td style={tdStyle}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => { setEditingId(rule.id); setShowForm(false); }} style={actionBtn}>
                      Edit
                    </button>
                    <Form method="post" style={{ display: "inline" }}>
                      <input type="hidden" name="intent" value="toggle" />
                      <input type="hidden" name="id" value={rule.id} />
                      <button type="submit" style={actionBtn}>
                        {rule.isActive ? "Disable" : "Enable"}
                      </button>
                    </Form>
                    <Form method="post" style={{ display: "inline" }} onSubmit={(e) => {
                      if (!confirm(`Delete rule for ${rule.country}?`)) e.preventDefault();
                    }}>
                      <input type="hidden" name="intent" value="delete" />
                      <input type="hidden" name="id" value={rule.id} />
                      <button type="submit" style={{ ...actionBtn, color: "#dc2626" }}>
                        Delete
                      </button>
                    </Form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4, color: "#374151" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, boxSizing: "border-box" };
const thStyle: React.CSSProperties = { padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" };
const tdStyle: React.CSSProperties = { padding: "10px 14px" };
const btnPrimary: React.CSSProperties = { padding: "8px 16px", backgroundColor: "#6c5ce7", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 };
const btnSecondary: React.CSSProperties = { padding: "8px 16px", backgroundColor: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer", fontSize: 14 };
const actionBtn: React.CSSProperties = { background: "none", border: "none", color: "#6c5ce7", cursor: "pointer", fontSize: 13, padding: "2px 6px" };
