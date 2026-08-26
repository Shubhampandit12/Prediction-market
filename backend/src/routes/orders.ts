import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware.js";
import { CreateOrderSchema } from "../types.js";
import { executeOrder, parseOrderbook } from "../matching.js";

const router = Router();

/**
 * POST /order
 * Places a limit order on a market. Runs matching engine in a transaction.
 */
router.post("/order", requireAuth, async (req, res) => {
  const { success, data } = CreateOrderSchema.safeParse(req.body);
  const userId = req.userId;

  if (!success || !data) {
    res.status(411).json({ message: "Incorrect inputs" });
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Fetch the market to get current orderbooks
      const market = await tx.market.findUniqueOrThrow({
        where: { id: data.marketId },
      });

      const yesOrderbook = parseOrderbook(market.yesOrderbook);
      const noOrderbook = parseOrderbook(market.noOrderbook);

      // Run the matching engine
      const result = await executeOrder(tx, userId, data, yesOrderbook, noOrderbook);

      // Persist updated orderbooks, plus any new shares minted this order
      await tx.market.update({
        where: { id: data.marketId },
        data: {
          yesOrderbook: JSON.stringify(result.yesOrderbook),
          noOrderbook: JSON.stringify(result.noOrderbook),
          totalQty: { increment: result.mintedPairs * 2 },
        },
      });
    });

    res.json({ message: "Order executed successfully" });
  } catch (error: any) {
    console.error("Error executing order:", error);
    if (error.message === "Insufficient USD balance") {
      res.status(403).json({
        message: "Sorry you dont have enough $ in your account",
      });
    } else if (
      error.message === "Insufficient Yes position" ||
      error.message === "Insufficient No position"
    ) {
      res.status(403).json({
        message: "Sorry you dont have enough position",
      });
    } else {
      res.status(500).json({ message: "Error executing order" });
    }
  }
});

export default router;
