import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { requireAdmin } from "~/admin.server";
import { prisma } from "~/db.server";
import { logAudit } from "~/services/audit.server";

const WAREHOUSE_KEYS = [
  { key: "warehouse.name", label: "Warehouse Name", env: "FulfillHub Warehouse" },
  { key: "warehouse.company", label: "Company", env: "FulfillHub" },
  { key: "warehouse.line1", label: "Address Line 1", env: process.env.WAREHOUSE_ADDRESS_LINE1 || "" },
  { key: "warehouse.line2", label: "Address Line 2", env: "" },
  { key: "warehouse.city", label: "City", env: process.env.WAREHOUSE_CITY || "Istanbul" },
  { key: "warehouse.province", label: "Province/State", env: process.env.WAREHOUSE_PROVINCE || "Istanbul" },
  { key: "warehouse.country", label: "Country (ISO 2-letter)", env: "TR" },
  { key: "warehouse.zip", label: "ZIP / Postal Code", env: process.env.WAREHOUSE_ZIP || "34000" },
  { key: "warehouse.phone", label: "Phone", env: process.env.WAREHOUSE_PHONE || "+905001234567" },
  { key: "warehouse.email", label: "Email", env: process.env.WAREHOUSE_EMAIL || "ops@fulfillhub.com" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdmin(request);

  const settings = await prisma.appSetting.findMany({
    where: { key: { startsWith: "warehouse." } },
  });

  const settingsMap: Record<string, string> = {};
  for (const s of settings) {
    settingsMap[s.key] = s.value;
  }

  const fields = WAREHOUSE_KEYS.map((wk) => ({
    key: wk.key,
    label: wk.label,
    value: settingsMap[wk.key] ?? wk.env,
  }));

  return json({ fields });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const admin = await requireAdmin(request);
  const formData = await request.formData();

  const updates: { key: string; value: string }[] = [];
  for (const wk of WAREHOUSE_KEYS) {
    const value = (formData.get(wk.key) as string) || "";
    updates.push({ key: wk.key, value });
  }

  for (const { key, value } of updates) {
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  await logAudit({
    actorType: "ADMIN",
    actorId: admin.id,
    action: "warehouse.settings_updated",
    entityType: "AppSetting",
    entityId: "warehouse",
    details: Object.fromEntries(updates.map((u) => [u.key, u.value])),
  });

  return json({ success: true, message: "Warehouse settings saved" });
};

export default function WarehouseConfig() {
  const { fields } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div>
      <h1 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 700 }}>Warehouse</h1>
      <p style={{ margin: "0 0 24px", color: "#666", fontSize: 14 }}>
        Configure the warehouse address used as the sender for all shipments.
      </p>

      {actionData && "message" in actionData && (
        <div style={{ padding: "10px 14px", backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, color: "#16a34a", fontSize: 14, marginBottom: 16 }}>
          {actionData.message}
        </div>
      )}

      <div style={{ backgroundColor: "#fff", borderRadius: 8, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
        <Form method="post">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {fields.map((field) => (
              <div key={field.key}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4, color: "#374151" }}>
                  {field.label}
                </label>
                <input
                  name={field.key}
                  defaultValue={field.value}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    border: "1px solid #d1d5db",
                    borderRadius: 6,
                    fontSize: 14,
                    boxSizing: "border-box",
                  }}
                />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 24 }}>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                padding: "10px 20px",
                backgroundColor: "#6c5ce7",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: isSubmitting ? "not-allowed" : "pointer",
                fontWeight: 600,
                fontSize: 14,
                opacity: isSubmitting ? 0.7 : 1,
              }}
            >
              {isSubmitting ? "Saving..." : "Save Warehouse Settings"}
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}
