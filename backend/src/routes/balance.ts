import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware.js";
import { OnrampSchema, OfframpSchema } from "../types.js";

const router = Router();

/**
 * GET /balance
 * Returns the authenticated user's USD balance.
 */
router.get("/balance", requireAuth, async (req, res) => {
  const userId = req.userId;
  const user = await prisma.user.findFirst({ where: { id: userId } });
  res.json({ usdBalance: user?.usdBalance ?? 0 });
});

/**
 * POST /onramp
 * Simulates depositing USD. Amount is in dollars, stored as cents.
 */
router.post("/onramp", requireAuth, async (req, res) => {
  const { success, data } = OnrampSchema.safeParse(req.body);
  const userId = req.userId;

  if (!success || !data) {
    res.status(411).json({ message: "Incorrect inputs" });
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });

      // Convert USD amount to cents (integer) for storage
      const amountInCents = Math.round(data.amount * 100);

      await tx.user.update({
        where: { id: userId },
        data: { usdBalance: { increment: amountInCents } },
      });
    });

    res.json({ message: "Onramp successful", amount: data.amount });
  } catch (error: any) {
    console.error("Error processing onramp:", error);
    res.status(500).json({ message: "Error processing onramp" });
  }
});

/**
 * POST /offramp
 * Simulates withdrawing USD. Amount is in dollars, stored as cents.
 */
router.post("/offramp", requireAuth, async (req, res) => {
  const { success, data } = OfframpSchema.safeParse(req.body);
  const userId = req.userId;

  if (!success || !data) {
    res.status(411).json({ message: "Incorrect inputs" });
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });

      // Convert USD amount to cents (integer) for storage
      const amountInCents = Math.round(data.amount * 100);

      if (user.usdBalance < amountInCents) {
        throw new Error("Insufficient USD balance");
      }

      await tx.user.update({
        where: { id: userId },
        data: { usdBalance: { decrement: amountInCents } },
      });
    });

    res.json({ message: "Offramp successful", amount: data.amount });
  } catch (error: any) {
    console.error("Error processing offramp:", error);
    if (error.message === "Insufficient USD balance") {
      res.status(403).json({ message: "Insufficient USD balance for offramp" });
    } else {
      res.status(500).json({ message: "Error processing offramp" });
    }
  }
});

export default router;
