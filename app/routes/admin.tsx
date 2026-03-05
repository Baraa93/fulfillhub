import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useLocation } from "@remix-run/react";
import { requireAdmin } from "~/admin.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const admin = await requireAdmin(request);
  return json({ admin });
};

const NAV_ITEMS = [
  { label: "Dashboard", href: "/admin" },
  { label: "Shipping Rules", href: "/admin/shipping-rules" },
  { label: "Warehouse", href: "/admin/warehouse" },
  { label: "Settings", href: "/admin/settings" },
];

export default function AdminLayout() {
  const { admin } = useLoaderData<typeof loader>();
  const location = useLocation();

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "system-ui, sans-serif" }}>
      {/* Sidebar */}
      <nav
        style={{
          width: 240,
          backgroundColor: "#1a1a2e",
          color: "#fff",
          padding: "20px 0",
          flexShrink: 0,
        }}
      >
        <div style={{ padding: "0 20px 20px", borderBottom: "1px solid #333" }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>FulfillHub</h1>
          <p style={{ margin: "4px 0 0", fontSize: 12, opacity: 0.7 }}>Admin Panel</p>
        </div>

        <ul style={{ listStyle: "none", padding: 0, margin: "12px 0" }}>
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.href === "/admin"
                ? location.pathname === "/admin"
                : location.pathname.startsWith(item.href);

            return (
              <li key={item.href}>
                <Link
                  to={item.href}
                  style={{
                    display: "block",
                    padding: "10px 20px",
                    color: isActive ? "#fff" : "rgba(255,255,255,0.7)",
                    backgroundColor: isActive ? "rgba(255,255,255,0.1)" : "transparent",
                    textDecoration: "none",
                    fontSize: 14,
                    borderLeft: isActive ? "3px solid #6c5ce7" : "3px solid transparent",
                  }}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div
          style={{
            position: "absolute",
            bottom: 0,
            width: 240,
            padding: "16px 20px",
            borderTop: "1px solid #333",
            fontSize: 12,
          }}
        >
          <p style={{ margin: 0, opacity: 0.7 }}>{admin.name}</p>
          <p style={{ margin: "2px 0 8px", opacity: 0.5 }}>{admin.role}</p>
          <form method="post" action="/admin/login?_action=logout">
            <button
              type="submit"
              style={{
                background: "none",
                border: "1px solid rgba(255,255,255,0.3)",
                color: "#fff",
                padding: "4px 12px",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              Log out
            </button>
          </form>
        </div>
      </nav>

      {/* Main content */}
      <main style={{ flex: 1, backgroundColor: "#f6f6f7", padding: 32, overflow: "auto" }}>
        <Outlet />
      </main>
    </div>
  );
}
