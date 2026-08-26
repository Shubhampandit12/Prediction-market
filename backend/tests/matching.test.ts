import { v4 as uuid } from "uuid";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { executeOrder } from "../src/matching.js";
import { createMarket, createUser, resetDb } from "./helpers.js";
import type { Orderbook } from "../src/types.js";

async function getPosition(userId: string, marketId: string, type: "Yes" | "No") {
  return prisma.position.findUnique({
    where: { userId_marketId_type: { userId, marketId, type } },
  });
}

async function getBalance(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return user.usdBalance;
}

beforeEach(async () => {
  await resetDb();
});

describe("matching engine: both books empty", () => {
  it("rests the full quantity as a reverse order on the opposite book, with no debit yet", async () => {
    const market = await createMarket();
    const alice = await createUser(10000);

    const result = await prisma.$transaction((tx) =>
      executeOrder(
        tx,
        alice.id,
        { marketId: market.id, side: "yes", type: "buy", price: 60, qty: 10 },
        {},
        {}
      )
    );

    expect(result.mintedPairs).toBe(0);
    expect(result.yesOrderbook).toEqual({});
    expect(result.noOrderbook["40"]).toMatchObject({
      availableQty: 10,
      orders: [expect.objectContaining({ userId: alice.id, qty: 10, reverseOrder: true })],
    });

    // Nothing matched, so no cash has actually moved yet.
    expect(await getBalance(alice.id)).toBe(10000);
    expect(await getPosition(alice.id, market.id, "Yes")).toBeNull();
  });
});

describe("matching engine: full fill against a resting sell order", () => {
  it("transfers shares and cash between the two real users without minting", async () => {
    const market = await createMarket();
    const alice = await createUser(10000);
    const bob = await createUser(0);

    // Bob is resting a sell order for shares he already holds.
    await prisma.position.create({
      data: { userId: bob.id, marketId: market.id, type: "Yes", qty: 10 },
    });
    const yesOrderbook: Orderbook = {
      "60": {
        availableQty: 10,
        orders: [{ userId: bob.id, qty: 10, filledQty: 0, originalOrderId: uuid(), reverseOrder: false }],
      },
    };

    const result = await prisma.$transaction((tx) =>
      executeOrder(
        tx,
        alice.id,
        { marketId: market.id, side: "yes", type: "buy", price: 60, qty: 10 },
        yesOrderbook,
        {}
      )
    );

    expect(result.mintedPairs).toBe(0);
    expect(result.yesOrderbook["60"]!.availableQty).toBe(0);
    expect(result.noOrderbook).toEqual({});

    expect(await getBalance(alice.id)).toBe(10000 - 600);
    expect(await getBalance(bob.id)).toBe(600);
    expect((await getPosition(alice.id, market.id, "Yes"))?.qty).toBe(10);
    expect((await getPosition(bob.id, market.id, "Yes"))?.qty).toBe(0);
  });
});

describe("matching engine: partial fill", () => {
  it("matches what it can and rests the remainder as a reverse order", async () => {
    const market = await createMarket();
    const alice = await createUser(10000);
    const bob = await createUser(0);

    await prisma.position.create({
      data: { userId: bob.id, marketId: market.id, type: "Yes", qty: 10 },
    });
    const yesOrderbook: Orderbook = {
      "55": {
        availableQty: 10,
        orders: [{ userId: bob.id, qty: 10, filledQty: 0, originalOrderId: uuid(), reverseOrder: false }],
      },
    };

    // Alice wants 15 @ up to 60c; only 10 are available at 55c.
    const result = await prisma.$transaction((tx) =>
      executeOrder(
        tx,
        alice.id,
        { marketId: market.id, side: "yes", type: "buy", price: 60, qty: 15 },
        yesOrderbook,
        {}
      )
    );

    expect(result.mintedPairs).toBe(0);
    expect(result.yesOrderbook["55"]!.availableQty).toBe(0);
    // Leftover 5 rests as a reverse order at 100 - 60 = 40 on the NO book.
    expect(result.noOrderbook["40"]).toMatchObject({
      availableQty: 5,
      orders: [expect.objectContaining({ userId: alice.id, qty: 5, reverseOrder: true })],
    });

    // Only the matched 10 shares were actually paid for, at the resting price (55), not her limit (60).
    expect(await getBalance(alice.id)).toBe(10000 - 10 * 55);
    expect(await getBalance(bob.id)).toBe(10 * 55);
    expect((await getPosition(alice.id, market.id, "Yes"))?.qty).toBe(10);
  });
});

describe("matching engine: reverse-order minting", () => {
  it("mints a fresh YES+NO pair when a resting reverse order is matched, reproducing the README trace", async () => {
    const market = await createMarket();
    const alice = await createUser(10000);
    const bob = await createUser(10000);

    // Step 1: Alice buys 10 YES @ 60c against empty books -> rests a reverse order on NO @ 40c.
    const afterAlice = await prisma.$transaction((tx) =>
      executeOrder(
        tx,
        alice.id,
        { marketId: market.id, side: "yes", type: "buy", price: 60, qty: 10 },
        {},
        {}
      )
    );
    expect(afterAlice.mintedPairs).toBe(0);

    // Step 2: Bob buys 10 NO @ 40c, matching Alice's resting reverse order -> mints the pair.
    const afterBob = await prisma.$transaction((tx) =>
      executeOrder(
        tx,
        bob.id,
        { marketId: market.id, side: "no", type: "buy", price: 40, qty: 10 },
        afterAlice.yesOrderbook,
        afterAlice.noOrderbook
      )
    );

    expect(afterBob.mintedPairs).toBe(10);
    expect(afterBob.yesOrderbook).toEqual({});
    // The engine decrements availableQty to 0 but doesn't prune the emptied entry.
    expect(afterBob.noOrderbook["40"]!.availableQty).toBe(0);

    expect(await getBalance(alice.id)).toBe(10000 - 600);
    expect(await getBalance(bob.id)).toBe(10000 - 400);
    expect((await getPosition(alice.id, market.id, "Yes"))?.qty).toBe(10);
    expect((await getPosition(bob.id, market.id, "No"))?.qty).toBe(10);

    // Conservation of value: combined debit equals exactly 10 pairs * 100c.
    const combinedDebit = 600 + 400;
    expect(combinedDebit).toBe(10 * 100);
  });
});

describe("matching engine: self-trade prevention", () => {
  it("does not match a user's order against their own resting order", async () => {
    const market = await createMarket();
    const alice = await createUser(10000);

    await prisma.position.create({
      data: { userId: alice.id, marketId: market.id, type: "Yes", qty: 10 },
    });
    const yesOrderbook: Orderbook = {
      "55": {
        availableQty: 10,
        orders: [{ userId: alice.id, qty: 10, filledQty: 0, originalOrderId: uuid(), reverseOrder: false }],
      },
    };

    // Alice tries to buy YES at a price that would otherwise match her own resting sell.
    const result = await prisma.$transaction((tx) =>
      executeOrder(
        tx,
        alice.id,
        { marketId: market.id, side: "yes", type: "buy", price: 60, qty: 10 },
        yesOrderbook,
        {}
      )
    );

    // No match happened: her own resting order is untouched, and the new order rests as a reverse order.
    expect(result.yesOrderbook["55"]!.availableQty).toBe(10);
    expect(result.mintedPairs).toBe(0);
    expect(result.noOrderbook["40"]).toMatchObject({ availableQty: 10 });
    expect(await getBalance(alice.id)).toBe(10000);
    expect((await getPosition(alice.id, market.id, "Yes"))?.qty).toBe(10);
  });
});

describe("matching engine: resting order matched by a later, independent call", () => {
  it("carries a resting non-reverse order across two separate executeOrder invocations", async () => {
    const market = await createMarket();
    const alice = await createUser(10000);
    const bob = await createUser(0);

    // Bob already holds 10 YES (e.g. from an earlier split) and rests a sell order.
    await prisma.position.create({
      data: { userId: bob.id, marketId: market.id, type: "Yes", qty: 10 },
    });

    const afterBobSell = await prisma.$transaction((tx) =>
      executeOrder(
        tx,
        bob.id,
        { marketId: market.id, side: "yes", type: "sell", price: 55, qty: 10 },
        {},
        {}
      )
    );
    expect(afterBobSell.mintedPairs).toBe(0);
    expect(afterBobSell.yesOrderbook["55"]).toMatchObject({
      availableQty: 10,
      orders: [expect.objectContaining({ userId: bob.id, qty: 10, reverseOrder: false })],
    });

    // A later, separate order from Alice matches Bob's still-resting sell order.
    const afterAliceBuy = await prisma.$transaction((tx) =>
      executeOrder(
        tx,
        alice.id,
        { marketId: market.id, side: "yes", type: "buy", price: 60, qty: 10 },
        afterBobSell.yesOrderbook,
        afterBobSell.noOrderbook
      )
    );

    expect(afterAliceBuy.mintedPairs).toBe(0);
    expect(afterAliceBuy.yesOrderbook["55"]!.availableQty).toBe(0);
    expect(await getBalance(bob.id)).toBe(10 * 55);
    expect(await getBalance(alice.id)).toBe(10000 - 10 * 55);
    expect((await getPosition(alice.id, market.id, "Yes"))?.qty).toBe(10);
    expect((await getPosition(bob.id, market.id, "Yes"))?.qty).toBe(0);
  });
});
