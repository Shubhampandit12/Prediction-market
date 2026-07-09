import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "./db.js";
import { env } from "./env.js";

const router = Router();

const AuthSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

/**
 * POST /auth/register
 * Creates a new user, returns JWT token and user info.
 */
router.post("/register", async (req, res) => {
  const parsed = AuthSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid email or password (min 6 chars)" });
    return;
  }

  const { email, password } = parsed.data;

  // Check if user already exists
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ message: "Email already registered" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, passwordHash },
  });

  const token = jwt.sign({ userId: user.id }, env.JWT_SECRET, { expiresIn: "7d" });

  // Set httpOnly cookie
  res.cookie("token", token, {
    httpOnly: true,
    secure: false, // set true in production with HTTPS
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  res.json({ token, user: { id: user.id, email: user.email } });
});

/**
 * POST /auth/login
 * Verifies credentials, returns JWT token and user info.
 */
router.post("/login", async (req, res) => {
  const parsed = AuthSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid email or password" });
    return;
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    res.status(401).json({ message: "Invalid credentials" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ message: "Invalid credentials" });
    return;
  }

  const token = jwt.sign({ userId: user.id }, env.JWT_SECRET, { expiresIn: "7d" });

  res.cookie("token", token, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.json({ token, user: { id: user.id, email: user.email } });
});

/**
 * POST /auth/logout
 * Clears the auth cookie.
 */
router.post("/logout", (_req, res) => {
  res.clearCookie("token");
  res.json({ message: "Logged out" });
});

export default router;
