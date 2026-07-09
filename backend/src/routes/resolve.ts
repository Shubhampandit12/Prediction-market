import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware.js";
import { ResolveSchema } from "../types.js";

const router = Router();

/**
 * POST /markets/:id/resolve
 * Resolves a market: pays winners, clears positions and orderbooks.
 *
 * Resolution logic:
 * 1. Verify market exists and is not already resolved.
 * 2. Set market.resolution to "Yes" or "No".
 * 3. Find all positions for this market.
 * 4. For winners (position.type matches resolution): credit user balance += qty * 100 cents.
 * 5. Delete all positions for this market.
 * 6. Clear both orderbooks to "{}".
 * 7. Create OrderHistory entries for the settlement.
 */
router.post("/markets/:id/resolve", requireAuth, async (req, res) => {
  const marketId = req.params.id;
  const parsed = ResolveSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(411).json({ message: "Incorrect inputs" });
    return;
  }

  const { resolution } = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Find market, check not already resolved
      const market = await tx.market.findUniqueOrThrow({ where: { id: marketId } });

      if (market.resolution) {
        throw new Error("Market already resolved");
      }

      // 2. Set resolution
      await tx.market.update({
        where: { id: marketId },
        data: {
          resolution,
          yesOrderbook: "{}",
          noOrderbook: "{}",
        },
      });

      // 3. Find all positions for this market
      const positions = await tx.position.findMany({
        where: { marketId },
      });

      // 4. Credit winners: position.type === resolution gets qty * 100 cents ($1 per share)
      for (const position of positions) {
        if (position.type === resolution) {
          await tx.user.update({
            where: { id: position.userId },
            data: { usdBalance: { increment: position.qty * 100 } },
          });

          // 7. Create OrderHistory for settlement payout
          await tx.orderHistory.create({
            data: {
              orderType: "Settlement",
              userId: position.userId,
              price: 100,
              qty: position.qty,
              marketId,
            },
          });
        }
      }

      // 5. Delete all positions for this market
      await tx.position.deleteMany({ where: { marketId } });
    });

    res.json({ message: "Market resolved", resolution });
  } catch (error: any) {
    console.error("Error resolving market:", error);
    if (error.message === "Market already resolved") {
      res.status(400).json({ message: "Market already resolved" });
    } else {
      res.status(500).json({ message: "Error resolving market" });
    }
  }
});

export default router;
