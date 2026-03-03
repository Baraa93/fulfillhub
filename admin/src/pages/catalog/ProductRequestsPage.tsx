import { useEffect, useState } from "react";
import { api } from "../../api/client";

interface ProductRequest {
  id: string;
  trendyolUrl: string;
  notes: string;
  desiredCategory: string;
  status: string;
  adminNotes: string;
  createdAt: string;
  seller: { shopDomain: string; shopName: string };
}

export default function ProductRequestsPage() {
  const [requests, setRequests] = useState<ProductRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRequests = () => {
    setLoading(true);
    api<{ requests: ProductRequest[] }>("/product-requests")
      .then((data) => setRequests(data.requests))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  };

  useEffect(fetchRequests, []);

  const handleReview = async (id: string, action: "APPROVED" | "REJECTED") => {
    try {
      await api("/product-requests/review", {
        method: "POST",
        body: JSON.stringify({ requestId: id, status: action }),
      });
      fetchRequests();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Action failed");
    }
  };

  const STATUS_BADGES: Record<string, string> = {
    PENDING: "badge-warning",
    UNDER_REVIEW: "badge-info",
    APPROVED: "badge-success",
    REJECTED: "badge-critical",
  };

  return (
    <div>
      <div className="page-header">
        <h1>Product Requests</h1>
        <p>Review seller product requests from Trendyol</p>
      </div>

      <div className="card">
        {loading ? (
          <p>Loading requests...</p>
        ) : requests.length === 0 ? (
          <div className="empty-state">
            <h3>No product requests</h3>
            <p>Requests will appear here when sellers submit Trendyol links.</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Seller</th>
                <th>Trendyol URL</th>
                <th>Category</th>
                <th>Notes</th>
                <th>Status</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => (
                <tr key={req.id}>
                  <td>{req.seller?.shopName || req.seller?.shopDomain || "—"}</td>
                  <td>
                    <a href={req.trendyolUrl} target="_blank" rel="noopener noreferrer">
                      {req.trendyolUrl.length > 40 ? req.trendyolUrl.slice(0, 40) + "..." : req.trendyolUrl}
                    </a>
                  </td>
                  <td>{req.desiredCategory || "—"}</td>
                  <td>{req.notes || "—"}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGES[req.status] || "badge-default"}`}>
                      {req.status}
                    </span>
                  </td>
                  <td>{new Date(req.createdAt).toLocaleDateString()}</td>
                  <td>
                    {req.status === "PENDING" || req.status === "UNDER_REVIEW" ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          className="btn"
                          style={{ fontSize: 12, padding: "4px 8px", color: "#108043" }}
                          onClick={() => handleReview(req.id, "APPROVED")}
                        >
                          Approve
                        </button>
                        <button
                          className="btn"
                          style={{ fontSize: 12, padding: "4px 8px", color: "#bf0711" }}
                          onClick={() => handleReview(req.id, "REJECTED")}
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
