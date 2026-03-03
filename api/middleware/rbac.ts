import type { Request, Response, NextFunction } from "express";
import type { AdminTokenPayload } from "./auth";

type AdminRole = "SUPER_ADMIN" | "ADMIN" | "WAREHOUSE";

/**
 * Role-based access control middleware.
 * Usage: requireRole("SUPER_ADMIN", "ADMIN")
 */
export function requireRole(...allowedRoles: AdminRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const adminUser = (req as Request & { adminUser?: AdminTokenPayload })
      .adminUser;

    if (!adminUser) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    if (!allowedRoles.includes(adminUser.role)) {
      return res.status(403).json({
        error: `Access denied. Required role: ${allowedRoles.join(" or ")}`,
      });
    }

    next();
  };
}
