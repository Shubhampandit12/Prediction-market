/**
 * CLOB Matching Engine
 *
 * Faithfully reproduces the matching logic from the original Polymarket clone.
 * Handles all four order variants (yes/buy, yes/sell, no/buy, no/sell) through
 * one shared code path — see the note above `executeOrder` for the invariant
 * that makes that collapse possible.
 *
 * Key invariant: YES price + NO price = 100 cents ($1.00).
 * When a buy order cannot be filled from the same-side orderbook, a reverse
 * order is placed on the opposite-side orderbook at (100 - price).
 */

import { Prisma } from "@prisma/client";
import { v4 as uuid } from "uuid";
import type { Orderbook } from "./types.js";

type TransactionClient = Prisma.TransactionClient;
type ShareType = "Yes" | "No";

interface OrderData {
  marketId: string;
  side: "yes" | "no";
  type: "buy" | "sell";
  price: number;
  qty: number;
}

function typeName(side: "yes" | "no"): ShareType {
  return side === "yes" ? "Yes" : "No";
}

function oppositeType(type: ShareType): ShareType {
  return type === "Yes" ? "No" : "Yes";
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
 *
 * The four order variants collapse into one path because of an invariant in
 * how resting orders are stored: whichever book an order rests on always
 * matches the *type of shares that book's non-reverse sellers are holding* —
 * a resting entry on the YES book is always someone's YES shares, whether it
 * got there via a YES sell or as a NO buy's reverse order. So "which book do
 * we walk" and "what position does a matched non-reverse order affect" reduce
 * to the same two facts: is this order a buy or a sell (decides which book —
 * own side for buy, opposite side for sell — and the price direction), and
 * which side is it on (decides the type the placer ends up gaining or losing).
 * A matched reverse order always mints the *opposite* type from the book it
 * rests on, since that's the side its original placer was actually after.
 */
export async function executeOrder(
  tx: TransactionClient,
  userId: string,
  data: OrderData,
  yesOrderbook: Orderbook,
  noOrderbook: Orderbook
): Promise<{ yesOrderbook: Orderbook; noOrderbook: Orderbook; mintedPairs: number }> {
  const originalOrderId = uuid();
  // Pairs of shares (1 YES + 1 NO) newly created by matching against a reverse
  // order, i.e. actual open interest added — as opposed to a plain transfer of
  // existing shares between two users, which doesn't change total shares outstanding.
  let mintedPairs = 0;

  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  // Existence check only — matching itself never reads market fields.
  await tx.market.findUniqueOrThrow({ where: { id: data.marketId } });

  const isBuy = data.type === "buy";
  const selfType = typeName(data.side);
  const ownSideBook = data.side === "yes" ? yesOrderbook : noOrderbook;
  const oppositeSideBook = data.side === "yes" ? noOrderbook : yesOrderbook;

  const walkedBook = isBuy ? ownSideBook : oppositeSideBook;
  const walkedBookType = isBuy ? selfType : oppositeType(selfType);
  const priceLimit = isBuy ? data.price : 100 - data.price;

  if (isBuy) {
    const usd = data.qty * data.price;
    if (user.usdBalance < usd) {
      throw new Error("Insufficient USD balance");
    }
  } else {
    const position = await tx.position.findFirst({
      where: { userId, marketId: data.marketId, type: selfType },
    });
    if (!position || position.qty < data.qty) {
      throw new Error(`Insufficient ${selfType} position`);
    }
  }

  let leftQty = data.qty;
  const prices = Object.keys(walkedBook).sort((a, b) => Number(a) - Number(b));

  for (const price of prices) {
    if (Number(price) > priceLimit) continue;
    const { orders } = walkedBook[price]!;

    for (const order of orders) {
      if (leftQty <= 0) break;
      // Self-trade prevention: never match a user's new order against their own resting order.
      if (order.userId === userId) continue;

      const matchedQty = order.qty >= leftQty ? leftQty : order.qty;

      if (!order.reverseOrder) {
        // Counterparty is a genuine resting order: transfer their existing shares.
        await tx.position.update({
          where: {
            userId_marketId_type: { userId: order.userId, marketId: data.marketId, type: walkedBookType },
          },
          data: { qty: { decrement: matchedQty } },
        });
        await tx.user.update({
          where: { id: order.userId },
          data: { usdBalance: { increment: Number(price) * matchedQty } },
        });
      } else {
        // Counterparty's reverse order mints a brand-new YES+NO pair.
        const mintedType = oppositeType(walkedBookType);
        await tx.position.upsert({
          where: {
            userId_marketId_type: { userId: order.userId, marketId: data.marketId, type: mintedType },
          },
          update: { qty: { increment: matchedQty } },
          create: { userId: order.userId, marketId: data.marketId, type: mintedType, qty: matchedQty },
        });
        await tx.user.update({
          where: { id: order.userId },
          data: { usdBalance: { decrement: (100 - Number(price)) * matchedQty } },
        });
        mintedPairs += matchedQty;
      }

      if (isBuy) {
        // Buyer gains the position, paying the resting order's price.
        await tx.position.upsert({
          where: { userId_marketId_type: { userId, marketId: data.marketId, type: selfType } },
          update: { qty: { increment: matchedQty } },
          create: { userId, marketId: data.marketId, type: selfType, qty: matchedQty },
        });
        await tx.user.update({
          where: { id: userId },
          data: { usdBalance: { decrement: Number(price) * matchedQty } },
        });
      } else {
        // Seller gives up the position, getting paid the resting order's price.
        await tx.position.update({
          where: { userId_marketId_type: { userId, marketId: data.marketId, type: selfType } },
          data: { qty: { decrement: matchedQty } },
        });
        await tx.user.update({
          where: { id: userId },
          data: { usdBalance: { increment: Number(price) * matchedQty } },
        });
      }

      leftQty -= matchedQty;
      order.filledQty += matchedQty;
      walkedBook[price]!.availableQty -= matchedQty;
    }
  }

  // Remaining quantity rests on the book: a buy posts a reverse order on the
  // opposite side at (100 - price); a sell posts an ordinary order on its own
  // side at its limit price.
  if (leftQty > 0) {
    if (isBuy) {
      const restPrice = 100 - data.price;
      if (!oppositeSideBook[restPrice]) {
        oppositeSideBook[restPrice] = { availableQty: 0, orders: [] };
      }
      oppositeSideBook[restPrice]!.availableQty += leftQty;
      oppositeSideBook[restPrice]!.orders.push({
        qty: leftQty,
        userId,
        filledQty: 0,
        originalOrderId,
        reverseOrder: true,
      });
    } else {
      if (!ownSideBook[data.price]) {
        ownSideBook[data.price] = { availableQty: 0, orders: [] };
      }
      ownSideBook[data.price]!.availableQty += leftQty;
      ownSideBook[data.price]!.orders.push({
        qty: leftQty,
        userId,
        filledQty: 0,
        originalOrderId,
        reverseOrder: false,
      });
    }
  }

  await tx.orderHistory.create({
    data: {
      id: originalOrderId,
      orderType: isBuy ? "Buy" : "Sell",
      userId,
      price: data.price,
      qty: data.qty,
      marketId: data.marketId,
    },
  });

  return { yesOrderbook, noOrderbook, mintedPairs };
}
