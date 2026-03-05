import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { adminLogin, createSessionCookie, clearSessionCookie } from "~/admin.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // If already logged in, redirect to admin home
  const cookieHeader = request.headers.get("Cookie") || "";
  if (cookieHeader.includes("__admin_session=")) {
    return redirect("/admin");
  }
  return json({});
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const url = new URL(request.url);

  // Handle logout
  if (url.searchParams.get("_action") === "logout") {
    return redirect("/admin/login", {
      headers: { "Set-Cookie": clearSessionCookie() },
    });
  }

  const formData = await request.formData();
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    return json({ error: "Email and password are required" }, { status: 400 });
  }

  try {
    const { token } = await adminLogin(email, password);
    return redirect("/admin", {
      headers: { "Set-Cookie": createSessionCookie(token) },
    });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Login failed" },
      { status: 401 },
    );
  }
};

export default function AdminLogin() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#1a1a2e",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          backgroundColor: "#fff",
          borderRadius: 8,
          padding: 40,
          width: 400,
          boxShadow: "0 4px 24px rgba(0,0,0,0.2)",
        }}
      >
        <h1 style={{ margin: "0 0 4px", fontSize: 24 }}>FulfillHub</h1>
        <p style={{ margin: "0 0 24px", color: "#666", fontSize: 14 }}>Admin Panel Login</p>

        {actionData?.error && (
          <div
            style={{
              padding: "10px 14px",
              backgroundColor: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 6,
              color: "#dc2626",
              fontSize: 14,
              marginBottom: 16,
            }}
          >
            {actionData.error}
          </div>
        )}

        <Form method="post">
          <div style={{ marginBottom: 16 }}>
            <label
              htmlFor="email"
              style={{ display: "block", fontSize: 14, fontWeight: 500, marginBottom: 4 }}
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              style={{
                width: "100%",
                padding: "8px 12px",
                border: "1px solid #d1d5db",
                borderRadius: 6,
                fontSize: 14,
                boxSizing: "border-box",
              }}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label
              htmlFor="password"
              style={{ display: "block", fontSize: 14, fontWeight: 500, marginBottom: 4 }}
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              style={{
                width: "100%",
                padding: "8px 12px",
                border: "1px solid #d1d5db",
                borderRadius: 6,
                fontSize: 14,
                boxSizing: "border-box",
              }}
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              width: "100%",
              padding: "10px 16px",
              backgroundColor: "#6c5ce7",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              cursor: isSubmitting ? "not-allowed" : "pointer",
              opacity: isSubmitting ? 0.7 : 1,
            }}
          >
            {isSubmitting ? "Signing in..." : "Sign In"}
          </button>
        </Form>
      </div>
    </div>
  );
}
