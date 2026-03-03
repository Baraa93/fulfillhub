import { useEffect, useState } from "react";
import { api } from "../../api/client";

interface Order {
  id: string;
  shopifyOrderName: string;
  status: string;
  customerName: string;
  shippingCountry: string;
  totalAmountUsd: string;
  createdAt: string;
  seller: { shopName: string; shopDomain: string };
  shipments: Array<{ trackingNumber: string; carrier: string; status: string }>;
}

const STATUS_BADGES: Record<string, string> = {
  PENDING_PAYMENT: "badge-warning",
  PROCESSING: "badge-info",
  PURCHASED: "badge-info",
  ALLOCATED: "badge-info",
  PACKED: "badge-warning",
  SHIPPED: "badge-success",
  DELIVERED: "badge-success",
  EXCEPTION: "badge-critical",
  CANCELLED: "badge-critical",
  RETURNED: "badge-warning",
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");

  const fetchOrders = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    api<{ orders: Order[] }>(`/orders?${params}`)
      .then((data) => setOrders(data.orders))
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  };

  useEffect(fetchOrders, [statusFilter]);

  return (
    <div>
      <div className="page-header">
        <h1>Orders</h1>
        <p>Manage fulfillment orders</p>
      </div>

      <div className="filters">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="PROCESSING">Processing</option>
          <option value="PACKED">Packed</option>
          <option value="SHIPPED">Shipped</option>
          <option value="DELIVERED">Delivered</option>
          <option value="EXCEPTION">Exception</option>
          <option value="PENDING_PAYMENT">Pending Payment</option>
        </select>
      </div>

      <div className="card">
        {loading ? (
          <p>Loading orders...</p>
        ) : orders.length === 0 ? (
          <div className="empty-state">
            <h3>No orders found</h3>
            <p>Orders will appear here when sellers receive Shopify orders.</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Seller</th>
                <th>Customer</th>
                <th>Country</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Tracking</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td><strong>{order.shopifyOrderName || order.id.slice(0, 8)}</strong></td>
                  <td>{order.seller?.shopName || order.seller?.shopDomain || "—"}</td>
                  <td>{order.customerName || "—"}</td>
                  <td>{order.shippingCountry || "—"}</td>
                  <td>${Number(order.totalAmountUsd).toFixed(2)}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGES[order.status] || "badge-default"}`}>
                      {order.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td>{order.shipments?.[0]?.trackingNumber || "—"}</td>
                  <td>{new Date(order.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
