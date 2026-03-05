import { redirect } from "@remix-run/node";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "./db.server";
import type { AdminRole } from "@prisma/client";

const JWT_SECRET = process.env.JWT_SECRET || "change-this-to-a-random-64-char-string";
const COOKIE_NAME = "__admin_session";
const TOKEN_EXPIRY = "24h";

interface AdminPayload {
  id: string;
  email: string;
  role: AdminRole;
}

export async function adminLogin(email: string, password: string) {
  const user = await prisma.adminUser.findUnique({ where: { email } });
  if (!user || user.status !== "ACTIVE") {
    throw new Error("Invalid email or password");
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new Error("Invalid email or password");
  }

  await prisma.adminUser.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role } satisfies AdminPayload,
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY },
  );

  return { token, user };
}

export function createSessionCookie(token: string): string {
  const isProduction = process.env.NODE_ENV === "production";
  return [
    `${COOKIE_NAME}=${token}`,
    "Path=/admin",
    "HttpOnly",
    "SameSite=Lax",
    isProduction ? "Secure" : "",
    `Max-Age=${60 * 60 * 24}`, // 24 hours
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function getTokenFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : null;
}

export async function requireAdmin(
  request: Request,
  allowedRoles?: AdminRole[],
) {
  const token = getTokenFromRequest(request);
  if (!token) {
    throw redirect("/admin/login");
  }

  let payload: AdminPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET) as AdminPayload;
  } catch {
    throw redirect("/admin/login");
  }

  if (allowedRoles && !allowedRoles.includes(payload.role)) {
    throw new Response("Forbidden", { status: 403 });
  }

  const user = await prisma.adminUser.findUnique({
    where: { id: payload.id },
    select: { id: true, email: true, name: true, role: true, status: true },
  });

  if (!user || user.status !== "ACTIVE") {
    throw redirect("/admin/login");
  }

  return user;
}
