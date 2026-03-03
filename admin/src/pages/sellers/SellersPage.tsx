import { useEffect, useState } from "react";
import { api } from "../../api/client";

interface Seller {
  id: string;
  shopDomain: string;
  shopName: string;
  email: string;
  status: string;
  walletBalance: string;
  currency: string;
  installedAt: string;
  _count?: { orders: number; sellerProducts: number };
}

export default function SellersPage() {
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ sellers: Seller[] }>("/sellers")
      .then((data) => setSellers(data.sellers))
      .catch(() => setSellers([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1>Sellers</h1>
        <p>Manage Shopify store accounts</p>
      </div>

      <div className="card">
        {loading ? (
          <p>Loading sellers...</p>
        ) : sellers.length === 0 ? (
          <div className="empty-state">
            <h3>No sellers yet</h3>
            <p>Sellers appear here when they install the FulfillHub app.</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Store</th>
                <th>Domain</th>
                <th>Email</th>
                <th>Balance</th>
                <th>Orders</th>
                <th>Products</th>
                <th>Status</th>
                <th>Installed</th>
              </tr>
            </thead>
            <tbody>
              {sellers.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.shopName || "—"}</strong></td>
                  <td>{s.shopDomain}</td>
                  <td>{s.email || "—"}</td>
                  <td>${Number(s.walletBalance).toFixed(2)} {s.currency}</td>
                  <td>{s._count?.orders ?? 0}</td>
                  <td>{s._count?.sellerProducts ?? 0}</td>
                  <td>
                    <span className={`badge ${s.status === "ACTIVE" ? "badge-success" : s.status === "SUSPENDED" ? "badge-critical" : "badge-default"}`}>
                      {s.status}
                    </span>
                  </td>
                  <td>{new Date(s.installedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
