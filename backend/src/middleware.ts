import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "./env.js";

// Extend Express Request to include userId
declare global {
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}

/**
 * Auth middleware: verifies JWT from cookie ("token") or Authorization Bearer header.
 * On success, sets req.userId. On failure, returns 401.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // Try cookie first, then Authorization header
  let token: string | undefined = req.cookies?.token;

  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.slice(7);
    }
  }

  if (!token) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { userId: string };
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
  }
}
