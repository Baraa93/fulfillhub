import { NavLink, useNavigate } from "react-router-dom";
import { setToken } from "../api/client";

export default function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();

  const handleLogout = () => {
    setToken(null);
    navigate("/login");
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-header">FulfillHub Admin</div>
        <ul className="sidebar-nav">
          <li>
            <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
              Dashboard
            </NavLink>
          </li>
          <li>
            <NavLink to="/orders" className={({ isActive }) => (isActive ? "active" : "")}>
              Orders
            </NavLink>
          </li>
          <li>
            <NavLink to="/catalog" className={({ isActive }) => (isActive ? "active" : "")}>
              Catalog
            </NavLink>
          </li>
          <li>
            <NavLink to="/sellers" className={({ isActive }) => (isActive ? "active" : "")}>
              Sellers
            </NavLink>
          </li>
          <li>
            <NavLink to="/requests" className={({ isActive }) => (isActive ? "active" : "")}>
              Product Requests
            </NavLink>
          </li>
          <li>
            <a href="#" onClick={(e) => { e.preventDefault(); handleLogout(); }}>
              Logout
            </a>
          </li>
        </ul>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}
