import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { requireAdmin } from "~/admin.server";
import { prisma } from "~/db.server";
import { logAudit } from "~/services/audit.server";
import bcrypt from "bcryptjs";

const CARRIER_SETTINGS = [
  { key: "aramex.account_number", label: "Aramex Account Number", type: "text" },
  { key: "aramex.username", label: "Aramex Username", type: "text" },
  { key: "aramex.password", label: "Aramex Password", type: "password" },
  { key: "aramex.account_pin", label: "Aramex Account PIN", type: "password" },
  { key: "aramex.account_entity", label: "Aramex Account Entity", type: "text" },
  { key: "aramex.country_code", label: "Aramex Country Code", type: "text" },
  { key: "smsa.passkey", label: "SMSA Passkey", type: "password" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const admin = await requireAdmin(request);

  const [carrierSettings, adminUsers] = await Promise.all([
    prisma.appSetting.findMany({
      where: { key: { in: CARRIER_SETTINGS.map((s) => s.key) } },
    }),
    prisma.adminUser.findMany({
      select: { id: true, email: true, name: true, role: true, status: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const settingsMap: Record<string, string> = {};
  for (const s of carrierSettings) {
    settingsMap[s.key] = s.value;
  }

  return json({
    carrierFields: CARRIER_SETTINGS.map((s) => ({
      ...s,
      value: settingsMap[s.key] || "",
      masked: s.type === "password" && settingsMap[s.key] ? true : false,
    })),
    adminUsers,
    currentAdmin: admin,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const admin = await requireAdmin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  // Save carrier config
  if (intent === "save_carrier") {
    const updates: { key: string; value: string }[] = [];
    for (const s of CARRIER_SETTINGS) {
      const value = formData.get(s.key) as string;
      // Skip empty password fields (keep existing value)
      if (s.type === "password" && !value) continue;
      if (value !== undefined) {
        updates.push({ key: s.key, value: value || "" });
      }
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
      action: "carrier.settings_updated",
      entityType: "AppSetting",
      entityId: "carrier",
      details: { keysUpdated: updates.map((u) => u.key) },
    });

    return json({ success: true, message: "Carrier settings saved" });
  }

  // Create admin user (SUPER_ADMIN only)
  if (intent === "create_admin") {
    if (admin.role !== "SUPER_ADMIN") {
      return json({ error: "Only Super Admins can create admin users" }, { status: 403 });
    }

    const email = (formData.get("email") as string)?.trim();
    const name = (formData.get("name") as string)?.trim();
    const password = formData.get("password") as string;
    const role = formData.get("role") as "ADMIN" | "WAREHOUSE";

    if (!email || !name || !password) {
      return json({ error: "All fields are required" }, { status: 400 });
    }
    if (password.length < 8) {
      return json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const existing = await prisma.adminUser.findUnique({ where: { email } });
    if (existing) {
      return json({ error: "An admin with this email already exists" }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const newAdmin = await prisma.adminUser.create({
      data: { email, name, passwordHash, role: role || "ADMIN" },
    });

    await logAudit({
      actorType: "ADMIN",
      actorId: admin.id,
      action: "admin_user.created",
      entityType: "AdminUser",
      entityId: newAdmin.id,
      details: { email, role: role || "ADMIN" },
    });

    return json({ success: true, message: `Admin user ${email} created` });
  }

  // Toggle admin user status
  if (intent === "toggle_admin") {
    if (admin.role !== "SUPER_ADMIN") {
      return json({ error: "Only Super Admins can manage admin users" }, { status: 403 });
    }

    const userId = formData.get("userId") as string;
    if (userId === admin.id) {
      return json({ error: "You cannot deactivate yourself" }, { status: 400 });
    }

    const user = await prisma.adminUser.findUnique({ where: { id: userId } });
    if (!user) return json({ error: "User not found" }, { status: 404 });

    const newStatus = user.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    await prisma.adminUser.update({ where: { id: userId }, data: { status: newStatus } });

    await logAudit({
      actorType: "ADMIN",
      actorId: admin.id,
      action: `admin_user.${newStatus.toLowerCase()}`,
      entityType: "AdminUser",
      entityId: userId,
    });

    return json({ success: true, message: `User ${user.email} ${newStatus.toLowerCase()}` });
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

export default function AdminSettings() {
  const { carrierFields, adminUsers, currentAdmin } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div>
      <h1 style={{ margin: "0 0 24px", fontSize: 24, fontWeight: 700 }}>Settings</h1>

      {actionData && "error" in actionData && (
        <div style={alertError}>{actionData.error}</div>
      )}
      {actionData && "message" in actionData && (
        <div style={alertSuccess}>{actionData.message}</div>
      )}

      {/* Carrier Config */}
      <div style={cardStyle}>
        <h2 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 600 }}>Carrier Configuration</h2>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "#666" }}>
          API credentials for Aramex and SMSA. Leave password fields empty to keep existing values.
        </p>
        <Form method="post">
          <input type="hidden" name="intent" value="save_carrier" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {carrierFields.map((field) => (
              <div key={field.key}>
                <label style={labelStyle}>{field.label}</label>
                <input
                  name={field.key}
                  type={field.type}
                  defaultValue={field.type === "password" ? "" : field.value}
                  placeholder={field.masked ? "••••••• (saved)" : ""}
                  style={inputStyle}
                />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16 }}>
            <button type="submit" disabled={isSubmitting} style={btnPrimary}>
              {isSubmitting ? "Saving..." : "Save Carrier Settings"}
            </button>
          </div>
        </Form>
      </div>

      {/* Admin Users */}
      <div style={{ ...cardStyle, marginTop: 24 }}>
        <h2 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 600 }}>Admin Users</h2>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, marginBottom: 24 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Email</th>
              <th style={thStyle}>Role</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Last Login</th>
              {currentAdmin.role === "SUPER_ADMIN" && <th style={thStyle}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {adminUsers.map((user) => (
              <tr key={user.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={tdStyle}>{user.name}</td>
                <td style={tdStyle}>{user.email}</td>
                <td style={tdStyle}>
                  <span style={{
                    padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600,
                    backgroundColor: user.role === "SUPER_ADMIN" ? "#ede9fe" : user.role === "ADMIN" ? "#dbeafe" : "#fef3c7",
                    color: user.role === "SUPER_ADMIN" ? "#6d28d9" : user.role === "ADMIN" ? "#1d4ed8" : "#92400e",
                  }}>
                    {user.role}
                  </span>
                </td>
                <td style={tdStyle}>
                  <span style={{
                    padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600,
                    backgroundColor: user.status === "ACTIVE" ? "#dcfce7" : "#fee2e2",
                    color: user.status === "ACTIVE" ? "#166534" : "#991b1b",
                  }}>
                    {user.status}
                  </span>
                </td>
                <td style={tdStyle}>
                  {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : "Never"}
                </td>
                {currentAdmin.role === "SUPER_ADMIN" && (
                  <td style={tdStyle}>
                    {user.id !== currentAdmin.id && (
                      <Form method="post" style={{ display: "inline" }}>
                        <input type="hidden" name="intent" value="toggle_admin" />
                        <input type="hidden" name="userId" value={user.id} />
                        <button type="submit" style={actionBtn}>
                          {user.status === "ACTIVE" ? "Deactivate" : "Activate"}
                        </button>
                      </Form>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {currentAdmin.role === "SUPER_ADMIN" && (
          <>
            <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 600 }}>Add Admin User</h3>
            <Form method="post">
              <input type="hidden" name="intent" value="create_admin" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, alignItems: "end" }}>
                <div>
                  <label style={labelStyle}>Name</label>
                  <input name="name" required style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Email</label>
                  <input name="email" type="email" required style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Password (min 8 chars)</label>
                  <input name="password" type="password" required minLength={8} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Role</label>
                  <select name="role" style={inputStyle}>
                    <option value="ADMIN">Admin</option>
                    <option value="WAREHOUSE">Warehouse</option>
                  </select>
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <button type="submit" disabled={isSubmitting} style={btnPrimary}>
                  Create Admin
                </button>
              </div>
            </Form>
          </>
        )}
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = { backgroundColor: "#fff", borderRadius: 8, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" };
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4, color: "#374151" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, boxSizing: "border-box" };
const thStyle: React.CSSProperties = { padding: "8px 12px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" };
const tdStyle: React.CSSProperties = { padding: "8px 12px" };
const btnPrimary: React.CSSProperties = { padding: "8px 16px", backgroundColor: "#6c5ce7", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 };
const actionBtn: React.CSSProperties = { background: "none", border: "none", color: "#6c5ce7", cursor: "pointer", fontSize: 13, padding: "2px 6px" };
const alertError: React.CSSProperties = { padding: "10px 14px", backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#dc2626", fontSize: 14, marginBottom: 16 };
const alertSuccess: React.CSSProperties = { padding: "10px 14px", backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, color: "#16a34a", fontSize: 14, marginBottom: 16 };
