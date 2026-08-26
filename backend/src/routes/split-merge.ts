import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware.js";
import { SplitSchema } from "../types.js";

const router = Router();

/**
 * POST /split
 * Splits USD into equal YES + NO positions for a market.
 * User pays `amount` cents, gets `amount` qty of both YES and NO.
 */
router.post("/split", requireAuth, async (req, res) => {
  const { data, success } = SplitSchema.safeParse(req.body);
  const userId = req.userId;

  if (!success || !data) {
    res.status(411).json({ message: "Incorrect inputs" });
    return;
  }

  const marketId = data.marketId;

  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });

      if (user.usdBalance < data.amount) {
        throw new Error("Insufficient USD balance");
      }

      // Debit user balance
      await tx.user.update({
        where: { id: userId },
        data: { usdBalance: { decrement: data.amount } },
      });

      // Credit YES position
      await tx.position.upsert({
        where: {
          userId_marketId_type: { marketId, userId, type: "Yes" },
        },
        create: { marketId, userId, type: "Yes", qty: data.amount },
        update: { qty: { increment: data.amount } },
      });

      // Credit NO position
      await tx.position.upsert({
        where: {
          userId_marketId_type: { marketId, userId, type: "No" },
        },
        create: { marketId, userId, type: "No", qty: data.amount },
        update: { qty: { increment: data.amount } },
      });

      // Split mints a new YES+NO pair per unit, so total shares outstanding grows by 2x
      await tx.market.update({
        where: { id: marketId },
        data: { totalQty: { increment: data.amount * 2 } },
      });

      // Record in order history
      await tx.orderHistory.create({
        data: {
          orderType: "Split",
          userId,
          price: 0,
          qty: data.amount,
          marketId,
        },
      });
    });

    res.json({ message: "Split successful" });
  } catch (error: any) {
    console.error("Error splitting:", error);
    if (error.message === "Insufficient USD balance") {
      res.status(403).json({
        message: "Sorry you dont have enough $ in your account",
      });
    } else {
      res.status(500).json({ message: "Error splitting" });
    }
  }
});

/**
 * POST /merge
 * Merges equal YES + NO positions back into USD.
 * User burns `amount` qty of both YES and NO, gets `amount` cents back.
 */
router.post("/merge", requireAuth, async (req, res) => {
  const { data, success } = SplitSchema.safeParse(req.body);
  const userId = req.userId;

  if (!success || !data) {
    res.status(411).json({ message: "Incorrect inputs" });
    return;
  }

  const marketId = data.marketId;

  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });

      const yesPosition = await tx.position.findFirst({
        where: { userId, marketId, type: "Yes" },
      });

      const noPosition = await tx.position.findFirst({
        where: { userId, marketId, type: "No" },
      });

      if (!yesPosition || yesPosition.qty < data.amount) {
        throw new Error("Insufficient Yes position");
      }

      if (!noPosition || noPosition.qty < data.amount) {
        throw new Error("Insufficient No position");
      }

      // Decrement YES position
      await tx.position.update({
        where: {
          userId_marketId_type: { userId, marketId, type: "Yes" },
        },
        data: { qty: { decrement: data.amount } },
      });

      // Decrement NO position
      await tx.position.update({
        where: {
          userId_marketId_type: { userId, marketId, type: "No" },
        },
        data: { qty: { decrement: data.amount } },
      });

      // Credit user balance
      await tx.user.update({
        where: { id: userId },
        data: { usdBalance: { increment: data.amount } },
      });

      // Merge burns a YES+NO pair per unit, so total shares outstanding shrinks by 2x
      await tx.market.update({
        where: { id: marketId },
        data: { totalQty: { decrement: data.amount * 2 } },
      });

      // Record in order history
      await tx.orderHistory.create({
        data: {
          orderType: "Merge",
          userId,
          price: 0,
          qty: data.amount,
          marketId,
        },
      });
    });

    res.json({ message: "Merge successful" });
  } catch (error: any) {
    console.error("Error merging:", error);
    if (
      error.message === "Insufficient Yes position" ||
      error.message === "Insufficient No position"
    ) {
      res.status(403).json({
        message: "Sorry you dont have enough position",
      });
    } else {
      res.status(500).json({ message: "Error merging" });
    }
  }
});

export default router;
