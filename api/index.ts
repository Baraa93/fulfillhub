import express from "express";
import cors from "cors";
import { requireAdminAuth } from "./middleware/auth";
import adminAuthRoutes from "./routes/admin-auth";
import adminCatalogRoutes from "./routes/admin-catalog";
import adminOrderRoutes from "./routes/admin-orders";
import adminShippingRoutes from "./routes/admin-shipping";
import adminSellerRoutes from "./routes/admin-sellers";
import adminProductRequestRoutes from "./routes/admin-product-requests";
import adminAnalyticsRoutes from "./routes/admin-analytics";
import adminWalletRoutes from "./routes/admin-wallet";

const app = express();
const PORT = process.env.ADMIN_API_PORT || 3001;

// Middleware
app.use(cors({ origin: process.env.ADMIN_FRONTEND_URL || "http://localhost:5173" }));
app.use(express.json({ limit: "10mb" }));

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Public routes (no auth)
app.use("/api/admin/auth", adminAuthRoutes);

// Protected routes (require admin JWT)
app.use("/api/admin/catalog", requireAdminAuth, adminCatalogRoutes);
app.use("/api/admin/orders", requireAdminAuth, adminOrderRoutes);
app.use("/api/admin/shipping", requireAdminAuth, adminShippingRoutes);
app.use("/api/admin/sellers", requireAdminAuth, adminSellerRoutes);
app.use("/api/admin/product-requests", requireAdminAuth, adminProductRequestRoutes);
app.use("/api/admin/analytics", requireAdminAuth, adminAnalyticsRoutes);
app.use("/api/admin/wallet", requireAdminAuth, adminWalletRoutes);

// Global error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  },
);

app.listen(PORT, () => {
  console.log(`Admin API running on port ${PORT}`);
});

export default app;
