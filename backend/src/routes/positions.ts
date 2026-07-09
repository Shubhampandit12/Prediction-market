import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware.js";

const router = Router();

/**
 * GET /positions
 * Returns all positions for the authenticated user.
 */
router.get("/positions", requireAuth, async (req, res) => {
  const userId = req.userId;
  const positions = await prisma.position.findMany({
    where: { userId },
  });
  res.json({ positions });
});

export default router;
