import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware.js";
import { CreateMarketSchema } from "../types.js";

const router = Router();

/**
 * GET /markets
 * Returns all markets (public).
 */
router.get("/markets", async (_req, res) => {
  const markets = await prisma.market.findMany();
  res.json({ markets });
});

/**
 * GET /market?marketId=X
 * Returns a single market by ID (public).
 */
router.get("/market", async (req, res) => {
  const market = await prisma.market.findFirst({
    where: { id: req.query.marketId as string },
  });
  res.json({ market });
});

/**
 * POST /markets
 * Creates a new market (authenticated).
 */
router.post("/markets", requireAuth, async (req, res) => {
  const parsed = CreateMarketSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(411).json({ message: "Incorrect inputs" });
    return;
  }

  const market = await prisma.market.create({
    data: {
      title: parsed.data.title,
      description: parsed.data.description,
      resolutionDescription: parsed.data.resolutionDescription,
      yesOrderbook: "{}",
      noOrderbook: "{}",
      totalQty: 0,
      createdBy: req.userId,
    },
  });

  res.json(market);
});

export default router;
