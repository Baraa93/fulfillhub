import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { requireAdmin } from "~/admin.server";
import { prisma } from "~/db.server";
import { logAudit } from "~/services/audit.server";
import type { ProductRequestStatus } from "@prisma/client";

const btnPrimary: React.CSSProperties = { padding: "8px 16px", backgroundColor: "#6c5ce7", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 };
const btnDanger: React.CSSProperties = { padding: "8px 16px", backgroundColor: "#dc2626", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 };
const btnSecondary: React.CSSProperties = { padding: "8px 16px", backgroundColor: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer", fontSize: 14 };

const statusColors: Record<ProductRequestStatus, { bg: string; color: string }> = {
  PENDING: { bg: "#fef3c7", color: "#92400e" },
  UNDER_REVIEW: { bg: "#dbeafe", color: "#1d4ed8" },
  APPROVED: { bg: "#dcfce7", color: "#166534" },
  REJECTED: { bg: "#fee2e2", color: "#991b1b" },
};

const statusLabels: Record<ProductRequestStatus, string> = {
  PENDING: "Pending",
  UNDER_REVIEW: "Under Review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status") as ProductRequestStatus | null;

  const where = statusFilter ? { status: statusFilter } : {};

  const [requests, counts] = await Promise.all([
    prisma.productRequest.findMany({
      where,
      include: { seller: { select: { shopName: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.productRequest.groupBy({
      by: ["status"],
      _count: { status: true },
    }),
  ]);

  const countMap: Record<string, number> = {};
  for (const c of counts) {
    countMap[c.status] = c._count.status;
  }

  return json({ requests, countMap });
}

export async function action({ request }: ActionFunctionArgs) {
  const admin = await requireAdmin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const id = formData.get("id") as string;
  const adminNotes = (formData.get("adminNotes") as string) || "";

  if (!id) {
    return json({ error: "Request ID is required" }, { status: 400 });
  }

  if (intent === "review") {
    await prisma.productRequest.update({
      where: { id },
      data: { status: "UNDER_REVIEW" },
    });
    await logAudit({
      action: "PRODUCT_REQUEST_REVIEW",
      entityType: "ProductRequest",
      entityId: id,
      userId: admin.id,
      details: "Status set to UNDER_REVIEW",
    });
    return json({ success: true });
  }

  if (intent === "approve") {
    await prisma.productRequest.update({
      where: { id },
      data: {
        status: "APPROVED",
        adminNotes,
        reviewedBy: admin.id,
        reviewedAt: new Date(),
      },
    });
    await logAudit({
      action: "PRODUCT_REQUEST_APPROVED",
      entityType: "ProductRequest",
      entityId: id,
      userId: admin.id,
      details: adminNotes || "Approved",
    });
    return json({ success: true });
  }

  if (intent === "reject") {
    await prisma.productRequest.update({
      where: { id },
      data: {
        status: "REJECTED",
        adminNotes,
        reviewedBy: admin.id,
        reviewedAt: new Date(),
      },
    });
    await logAudit({
      action: "PRODUCT_REQUEST_REJECTED",
      entityType: "ProductRequest",
      entityId: id,
      userId: admin.id,
      details: adminNotes || "Rejected",
    });
    return json({ success: true });
  }

  return json({ error: "Invalid intent" }, { status: 400 });
}

export default function AdminProductRequests() {
  const { requests, countMap } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const currentStatus = searchParams.get("status") || "";

  const totalCount = Object.values(countMap).reduce((sum: number, c: number) => sum + c, 0);

  const tabs: { label: string; value: string; count: number }[] = [
    { label: "All", value: "", count: totalCount },
    { label: "Pending", value: "PENDING", count: countMap["PENDING"] || 0 },
    { label: "Under Review", value: "UNDER_REVIEW", count: countMap["UNDER_REVIEW"] || 0 },
    { label: "Approved", value: "APPROVED", count: countMap["APPROVED"] || 0 },
    { label: "Rejected", value: "REJECTED", count: countMap["REJECTED"] || 0 },
  ];

  const isSubmitting = navigation.state === "submitting";

  return (
    <div style={{ padding: 32, maxWidth: 960, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4, color: "#111827" }}>
        Product Requests{" "}
        <span style={{ fontWeight: 400, color: "#6b7280", fontSize: 18 }}>({requests.length})</span>
      </h1>

      {/* Status filter tabs */}
      <div style={{ display: "flex", gap: 8, marginTop: 20, marginBottom: 24, flexWrap: "wrap" }}>
        {tabs.map((tab) => {
          const isActive = currentStatus === tab.value;
          return (
            <Link
              key={tab.value}
              to={tab.value ? `?status=${tab.value}` : "?"}
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500,
                textDecoration: "none",
                backgroundColor: isActive ? "#6c5ce7" : "#f3f4f6",
                color: isActive ? "#fff" : "#374151",
                border: isActive ? "1px solid #6c5ce7" : "1px solid #e5e7eb",
              }}
            >
              {tab.label} ({tab.count})
            </Link>
          );
        })}
      </div>

      {/* Empty state */}
      {requests.length === 0 && (
        <div
          style={{
            padding: 48,
            textAlign: "center",
            backgroundColor: "#f9fafb",
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            color: "#6b7280",
            fontSize: 15,
          }}
        >
          No product requests found.
        </div>
      )}

      {/* Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {requests.map((req) => {
          const colors = statusColors[req.status as ProductRequestStatus];
          return (
            <div
              key={req.id}
              style={{
                backgroundColor: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                padding: 20,
                boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15, color: "#111827", marginBottom: 4 }}>
                    {req.seller.shopName}
                  </div>
                  <div style={{ fontSize: 13, color: "#6b7280" }}>
                    {new Date(req.createdAt).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
                <span
                  style={{
                    display: "inline-block",
                    padding: "4px 10px",
                    borderRadius: 9999,
                    fontSize: 12,
                    fontWeight: 600,
                    backgroundColor: colors.bg,
                    color: colors.color,
                  }}
                >
                  {statusLabels[req.status as ProductRequestStatus]}
                </span>
              </div>

              <div style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 500 }}>Trendyol URL: </span>
                <a
                  href={req.trendyolUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 13, color: "#6c5ce7", wordBreak: "break-all" }}
                >
                  {req.trendyolUrl}
                </a>
              </div>

              {req.desiredCategory && (
                <div style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 500 }}>Desired Category: </span>
                  <span style={{ fontSize: 13, color: "#111827" }}>{req.desiredCategory}</span>
                </div>
              )}

              {req.notes && (
                <div style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 500 }}>Seller Notes: </span>
                  <span style={{ fontSize: 13, color: "#111827" }}>{req.notes}</span>
                </div>
              )}

              {/* PENDING: Review button */}
              {req.status === "PENDING" && (
                <Form method="post" style={{ marginTop: 12 }}>
                  <input type="hidden" name="id" value={req.id} />
                  <input type="hidden" name="intent" value="review" />
                  <button type="submit" disabled={isSubmitting} style={btnSecondary}>
                    Review
                  </button>
                </Form>
              )}

              {/* UNDER_REVIEW: Admin notes + Approve/Reject */}
              {req.status === "UNDER_REVIEW" && (
                <div style={{ marginTop: 12 }}>
                  <textarea
                    form={`form-approve-${req.id}`}
                    name="adminNotes"
                    placeholder="Admin notes (optional)"
                    rows={3}
                    style={{
                      width: "100%",
                      padding: 10,
                      border: "1px solid #d1d5db",
                      borderRadius: 6,
                      fontSize: 14,
                      resize: "vertical",
                      marginBottom: 8,
                      boxSizing: "border-box",
                    }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <Form method="post" id={`form-approve-${req.id}`}>
                      <input type="hidden" name="id" value={req.id} />
                      <input type="hidden" name="intent" value="approve" />
                      <button type="submit" disabled={isSubmitting} style={btnPrimary}>
                        Approve
                      </button>
                    </Form>
                    <Form
                      method="post"
                      onSubmit={(e) => {
                        const approveForm = document.getElementById(`form-approve-${req.id}`) as HTMLFormElement | null;
                        const notesEl = approveForm?.querySelector("textarea[name=adminNotes]") as HTMLTextAreaElement | null;
                        if (notesEl) {
                          const hiddenInput = document.createElement("input");
                          hiddenInput.type = "hidden";
                          hiddenInput.name = "adminNotes";
                          hiddenInput.value = notesEl.value;
                          (e.currentTarget as HTMLFormElement).appendChild(hiddenInput);
                        }
                      }}
                    >
                      <input type="hidden" name="id" value={req.id} />
                      <input type="hidden" name="intent" value="reject" />
                      <button type="submit" disabled={isSubmitting} style={btnDanger}>
                        Reject
                      </button>
                    </Form>
                  </div>
                </div>
              )}

              {/* APPROVED/REJECTED: Show admin notes and reviewed date */}
              {(req.status === "APPROVED" || req.status === "REJECTED") && (
                <div style={{ marginTop: 12, padding: 12, backgroundColor: "#f9fafb", borderRadius: 6 }}>
                  {req.adminNotes && (
                    <div style={{ marginBottom: 6 }}>
                      <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 500 }}>Admin Notes: </span>
                      <span style={{ fontSize: 13, color: "#111827" }}>{req.adminNotes}</span>
                    </div>
                  )}
                  {req.reviewedAt && (
                    <div>
                      <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 500 }}>Reviewed: </span>
                      <span style={{ fontSize: 13, color: "#111827" }}>
                        {new Date(req.reviewedAt).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
