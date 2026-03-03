import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";

export interface AdminTokenPayload {
  userId: string;
  email: string;
  role: "SUPER_ADMIN" | "ADMIN" | "WAREHOUSE";
}

/**
 * Verify JWT token from Authorization header.
 * Attaches decoded payload to req.adminUser.
 */
export function requireAdminAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AdminTokenPayload;
    (req as Request & { adminUser: AdminTokenPayload }).adminUser = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * Generate JWT for admin user.
 */
export function generateAdminToken(payload: AdminTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "24h" });
}
