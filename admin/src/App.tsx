import { Routes, Route, Navigate } from "react-router-dom";
import { getToken } from "./api/client";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import OrdersPage from "./pages/orders/OrdersPage";
import CatalogPage from "./pages/catalog/CatalogPage";
import SellersPage from "./pages/sellers/SellersPage";
import ProductRequestsPage from "./pages/catalog/ProductRequestsPage";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <Routes>
                <Route index element={<Dashboard />} />
                <Route path="orders" element={<OrdersPage />} />
                <Route path="catalog" element={<CatalogPage />} />
                <Route path="sellers" element={<SellersPage />} />
                <Route path="requests" element={<ProductRequestsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
