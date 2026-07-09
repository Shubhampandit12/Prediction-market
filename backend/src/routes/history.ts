import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware.js";

const router = Router();

/**
 * POST /history
 * Returns all order history for the authenticated user.
 */
router.post("/history", requireAuth, async (req, res) => {
  const userId = req.userId;
  const history = await prisma.orderHistory.findMany({
    where: { userId },
  });
  res.json({ history });
});

export default router;
