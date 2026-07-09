/**
 * CLOB Matching Engine
 *
 * Faithfully reproduces the matching logic from the original Polymarket clone.
 * Handles all four order branches: yes/buy, yes/sell, no/buy, no/sell.
 *
 * Key invariant: YES price + NO price = 100 cents ($1.00).
 * When a buy order cannot be filled from the same-side orderbook, a reverse
 * order is placed on the opposite-side orderbook at (100 - price).
 */

import { Prisma } from "@prisma/client";
import { v4 as uuid } from "uuid";
import type { Orderbook } from "./types.js";

type TransactionClient = Prisma.TransactionClient;

interface OrderData {
  marketId: string;
  side: "yes" | "no";
  type: "buy" | "sell";
  price: number;
  qty: number;
}

/**
 * Parse orderbook from DB (stored as JSON string or object).
 */
export function parseOrderbook(orderbook: unknown): Orderbook {
  if (typeof orderbook === "string") {
    return JSON.parse(orderbook);
  }
  if (orderbook && typeof orderbook === "object") {
    return orderbook as Orderbook;
  }
  return {};
}

/**
 * Execute an order against the current orderbooks.
 * Returns the updated orderbooks after matching.
 *
 * This function performs all the Prisma mutations (position upserts, balance
 * updates) within the provided transaction client.
 */
export async function executeOrder(
  tx: TransactionClient,
  userId: string,
  data: OrderData,
  yesOrderbook: Orderbook,
  noOrderbook: Orderbook
): Promise<{ yesOrderbook: Orderbook; noOrderbook: Orderbook }> {
  const originalOrderId = uuid();

  // Fetch user and market within transaction (SQLite serializes writes)
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  const market = await tx.market.findUniqueOrThrow({ where: { id: data.marketId } });

  // ─── BRANCH 1: YES BUY ──────────────────────────────────────────────────────
  if (data.side === "yes" && data.type === "buy") {
    const usd = data.qty * data.price;
    if (user.usdBalance < usd) {
      throw new Error("Insufficient USD balance");
    }

    let leftQty = data.qty;

    // Match against existing YES sell orders (sorted by price ascending = cheapest first)
    const prices = Object.keys(yesOrderbook).sort((a, b) => Number(a) - Number(b));

    for (const price of prices) {
      if (Number(price) > data.price) continue;
      const { orders } = yesOrderbook[price]!;

      for (const order of orders) {
        if (leftQty <= 0) break;

        const matchedQty = order.qty >= leftQty ? leftQty : order.qty;
        const reverseOrder = order.reverseOrder;

        if (!reverseOrder) {
          // Seller is selling their YES position
          await tx.position.update({
            where: {
              userId_marketId_type: {
                userId: order.userId,
                marketId: data.marketId,
                type: "Yes",
              },
            },
            data: { qty: { decrement: matchedQty } },
          });
          await tx.user.update({
            where: { id: order.userId },
            data: { usdBalance: { increment: Number(price) * matchedQty } },
          });
        } else {
          // Reverse order: counterparty gets NO position (pair-minting)
          await tx.position.upsert({
            where: {
              userId_marketId_type: {
                userId: order.userId,
                marketId: data.marketId,
                type: "No",
              },
            },
            update: { qty: { increment: matchedQty } },
            create: {
              userId: order.userId,
              marketId: data.marketId,
              type: "No",
              qty: matchedQty,
            },
          });
          await tx.user.update({
            where: { id: order.userId },
            data: { usdBalance: { decrement: (100 - Number(price)) * matchedQty } },
          });
        }

        // Buyer gets YES position
        await tx.position.upsert({
          where: {
            userId_marketId_type: {
              userId,
              marketId: data.marketId,
              type: "Yes",
            },
          },
          update: { qty: { increment: matchedQty } },
          create: {
            userId,
            marketId: data.marketId,
            type: "Yes",
            qty: matchedQty,
          },
        });

        // Debit buyer
        await tx.user.update({
          where: { id: userId },
          data: { usdBalance: { decrement: Number(price) * matchedQty } },
        });

        leftQty -= matchedQty;
        order.filledQty += matchedQty;
        yesOrderbook[price]!.availableQty -= matchedQty;
      }
    }

    // Remaining quantity: place reverse order on NO side
    if (leftQty > 0) {
      const oppositePrice = 100 - data.price;
      if (!noOrderbook[oppositePrice]) {
        noOrderbook[oppositePrice] = { availableQty: 0, orders: [] };
      }
      noOrderbook[oppositePrice]!.availableQty += leftQty;
      noOrderbook[oppositePrice]!.orders.push({
        qty: leftQty,
        userId,
        filledQty: 0,
        originalOrderId,
        reverseOrder: true,
      });
    }
  }

  // ─── BRANCH 2: YES SELL ─────────────────────────────────────────────────────
  if (data.side === "yes" && data.type === "sell") {
    const buyPrice = 100 - data.price;

    const userPosition = await tx.position.findFirst({
      where: { userId, marketId: data.marketId, type: "Yes" },
    });

    if (!userPosition || userPosition.qty < data.qty) {
      throw new Error("Insufficient Yes position");
    }

    let leftQty = data.qty;

    // Match against NO sell orders (which are effectively YES buy offers)
    const prices = Object.keys(noOrderbook).sort((a, b) => Number(a) - Number(b));

    for (const price of prices) {
      if (Number(price) > buyPrice) continue;
      const { orders } = noOrderbook[price]!;

      for (const order of orders) {
        if (leftQty <= 0) break;

        const matchedQty = order.qty >= leftQty ? leftQty : order.qty;
        const reverseOrder = order.reverseOrder;

        if (!reverseOrder) {
          // Counterparty is selling their NO position
          await tx.position.update({
            where: {
              userId_marketId_type: {
                userId: order.userId,
                marketId: data.marketId,
                type: "No",
              },
            },
            data: { qty: { decrement: matchedQty } },
          });
          await tx.user.update({
            where: { id: order.userId },
            data: { usdBalance: { increment: Number(price) * matchedQty } },
          });
        } else {
          // Reverse order: counterparty gets YES position (pair-minting)
          await tx.position.upsert({
            where: {
              userId_marketId_type: {
                userId: order.userId,
                marketId: data.marketId,
                type: "Yes",
              },
            },
            update: { qty: { increment: matchedQty } },
            create: {
              userId: order.userId,
              marketId: data.marketId,
              type: "Yes",
              qty: matchedQty,
            },
          });
          await tx.user.update({
            where: { id: order.userId },
            data: { usdBalance: { decrement: (100 - Number(price)) * matchedQty } },
          });
        }

        // Seller loses YES position
        await tx.position.update({
          where: {
            userId_marketId_type: {
              userId,
              marketId: data.marketId,
              type: "Yes",
            },
          },
          data: { qty: { decrement: matchedQty } },
        });

        // Seller gets paid
        await tx.user.update({
          where: { id: userId },
          data: { usdBalance: { increment: Number(price) * matchedQty } },
        });

        leftQty -= matchedQty;
        order.filledQty += matchedQty;
        noOrderbook[price]!.availableQty -= matchedQty;
      }
    }

    // Remaining quantity: place sell order on YES side
    if (leftQty > 0) {
      if (!yesOrderbook[data.price]) {
        yesOrderbook[data.price] = { availableQty: 0, orders: [] };
      }
      yesOrderbook[data.price]!.availableQty += leftQty;
      yesOrderbook[data.price]!.orders.push({
        qty: leftQty,
        userId,
        filledQty: 0,
        originalOrderId,
        reverseOrder: false,
      });
    }
  }

  // ─── BRANCH 3: NO BUY ──────────────────────────────────────────────────────
  if (data.side === "no" && data.type === "buy") {
    const usd = data.qty * data.price;
    if (user.usdBalance < usd) {
      throw new Error("Insufficient USD balance");
    }

    let leftQty = data.qty;

    // Match against existing NO sell orders
    const prices = Object.keys(noOrderbook).sort((a, b) => Number(a) - Number(b));

    for (const price of prices) {
      if (Number(price) > data.price) continue;
      const { orders } = noOrderbook[price]!;

      for (const order of orders) {
        if (leftQty <= 0) break;

        const matchedQty = order.qty >= leftQty ? leftQty : order.qty;
        const reverseOrder = order.reverseOrder;

        if (!reverseOrder) {
          // Seller is selling their NO position
          await tx.position.update({
            where: {
              userId_marketId_type: {
                userId: order.userId,
                marketId: data.marketId,
                type: "No",
              },
            },
            data: { qty: { decrement: matchedQty } },
          });
          await tx.user.update({
            where: { id: order.userId },
            data: { usdBalance: { increment: Number(price) * matchedQty } },
          });
        } else {
          // Reverse order: counterparty gets YES position (pair-minting)
          await tx.position.upsert({
            where: {
              userId_marketId_type: {
                userId: order.userId,
                marketId: data.marketId,
                type: "Yes",
              },
            },
            update: { qty: { increment: matchedQty } },
            create: {
              userId: order.userId,
              marketId: data.marketId,
              type: "Yes",
              qty: matchedQty,
            },
          });
          await tx.user.update({
            where: { id: order.userId },
            data: { usdBalance: { decrement: (100 - Number(price)) * matchedQty } },
          });
        }

        // Buyer gets NO position
        await tx.position.upsert({
          where: {
            userId_marketId_type: {
              userId,
              marketId: data.marketId,
              type: "No",
            },
          },
          update: { qty: { increment: matchedQty } },
          create: {
            userId,
            marketId: data.marketId,
            type: "No",
            qty: matchedQty,
          },
        });

        // Debit buyer
        await tx.user.update({
          where: { id: userId },
          data: { usdBalance: { decrement: Number(price) * matchedQty } },
        });

        leftQty -= matchedQty;
        order.filledQty += matchedQty;
        noOrderbook[price]!.availableQty -= matchedQty;
      }
    }

    // Remaining quantity: place reverse order on YES side
    if (leftQty > 0) {
      const oppositePrice = 100 - data.price;
      if (!yesOrderbook[oppositePrice]) {
        yesOrderbook[oppositePrice] = { availableQty: 0, orders: [] };
      }
      yesOrderbook[oppositePrice]!.availableQty += leftQty;
      yesOrderbook[oppositePrice]!.orders.push({
        qty: leftQty,
        userId,
        filledQty: 0,
        originalOrderId,
        reverseOrder: true,
      });
    }
  }

  // ─── BRANCH 4: NO SELL ─────────────────────────────────────────────────────
  if (data.side === "no" && data.type === "sell") {
    const buyPrice = 100 - data.price;

    const userPosition = await tx.position.findFirst({
      where: { userId, marketId: data.marketId, type: "No" },
    });

    if (!userPosition || userPosition.qty < data.qty) {
      throw new Error("Insufficient No position");
    }

    let leftQty = data.qty;

    // Match against YES sell orders (which are effectively NO buy offers)
    const prices = Object.keys(yesOrderbook).sort((a, b) => Number(a) - Number(b));

    for (const price of prices) {
      if (Number(price) > buyPrice) continue;
      const { orders } = yesOrderbook[price]!;

      for (const order of orders) {
        if (leftQty <= 0) break;

        const matchedQty = order.qty >= leftQty ? leftQty : order.qty;
        const reverseOrder = order.reverseOrder;

        if (!reverseOrder) {
          // Counterparty is selling their YES position
          await tx.position.update({
            where: {
              userId_marketId_type: {
                userId: order.userId,
                marketId: data.marketId,
                type: "Yes",
              },
            },
            data: { qty: { decrement: matchedQty } },
          });
          await tx.user.update({
            where: { id: order.userId },
            data: { usdBalance: { increment: Number(price) * matchedQty } },
          });
        } else {
          // Reverse order: counterparty gets NO position (pair-minting)
          await tx.position.upsert({
            where: {
              userId_marketId_type: {
                userId: order.userId,
                marketId: data.marketId,
                type: "No",
              },
            },
            update: { qty: { increment: matchedQty } },
            create: {
              userId: order.userId,
              marketId: data.marketId,
              type: "No",
              qty: matchedQty,
            },
          });
          await tx.user.update({
            where: { id: order.userId },
            data: { usdBalance: { decrement: (100 - Number(price)) * matchedQty } },
          });
        }

        // Seller loses NO position
        await tx.position.update({
          where: {
            userId_marketId_type: {
              userId,
              marketId: data.marketId,
              type: "No",
            },
          },
          data: { qty: { decrement: matchedQty } },
        });

        // Seller gets paid
        await tx.user.update({
          where: { id: userId },
          data: { usdBalance: { increment: Number(price) * matchedQty } },
        });

        leftQty -= matchedQty;
        order.filledQty += matchedQty;
        yesOrderbook[price]!.availableQty -= matchedQty;
      }
    }

    // Remaining quantity: place sell order on NO side
    if (leftQty > 0) {
      if (!noOrderbook[data.price]) {
        noOrderbook[data.price] = { availableQty: 0, orders: [] };
      }
      noOrderbook[data.price]!.availableQty += leftQty;
      noOrderbook[data.price]!.orders.push({
        qty: leftQty,
        userId,
        filledQty: 0,
        originalOrderId,
        reverseOrder: false,
      });
    }
  }

  // Create order history record
  await tx.orderHistory.create({
    data: {
      id: originalOrderId,
      orderType: data.type === "buy" ? "Buy" : "Sell",
      userId,
      price: data.price,
      qty: data.qty,
      marketId: data.marketId,
    },
  });

  return { yesOrderbook, noOrderbook };
}
