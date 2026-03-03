import { useEffect, useState } from "react";
import { api } from "../api/client";

interface Stats {
  ordersToday: number;
  ordersPending: number;
  ordersPacked: number;
  ordersShipped: number;
  ordersException: number;
  totalSellers: number;
  activeSellers: number;
  lowBalanceSellers: number;
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Stats>("/analytics/dashboard")
      .then(setStats)
      .catch(() => {
        setStats({
          ordersToday: 0,
          ordersPending: 0,
          ordersPacked: 0,
          ordersShipped: 0,
          ordersException: 0,
          totalSellers: 0,
          activeSellers: 0,
          lowBalanceSellers: 0,
        });
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
        <p>FulfillHub operations overview</p>
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">Orders Today</div>
          <div className="value">{stats?.ordersToday ?? 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">Pending</div>
          <div className="value">{stats?.ordersPending ?? 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">Packed</div>
          <div className="value">{stats?.ordersPacked ?? 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">Shipped</div>
          <div className="value">{stats?.ordersShipped ?? 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">Exceptions</div>
          <div className="value">{stats?.ordersException ?? 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">Active Sellers</div>
          <div className="value">{stats?.activeSellers ?? 0}/{stats?.totalSellers ?? 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">Low Balance Sellers</div>
          <div className="value">{stats?.lowBalanceSellers ?? 0}</div>
        </div>
      </div>
    </div>
  );
}
