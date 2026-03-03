import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../app/db.server";
import { generateAdminToken } from "../middleware/auth";

const router = Router();

/**
 * POST /api/admin/auth/login
 *
 * Request:  { email: string, password: string }
 * Response: { token: string, user: { id, email, name, role } }
 */
router.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  const user = await prisma.adminUser.findUnique({ where: { email } });

  if (!user || user.status !== "ACTIVE") {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  await prisma.adminUser.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const token = generateAdminToken({
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  return res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  });
});

/**
 * POST /api/admin/auth/register (SUPER_ADMIN only — called from seed or admin UI)
 *
 * Request:  { email, password, name, role }
 * Response: { user: { id, email, name, role } }
 */
router.post("/register", async (req: Request, res: Response) => {
  const { email, password, name, role } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: "Email, password, and name required" });
  }

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "Email already registered" });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.adminUser.create({
    data: {
      email,
      passwordHash,
      name,
      role: role || "ADMIN",
    },
  });

  return res.status(201).json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  });
});

export default router;
