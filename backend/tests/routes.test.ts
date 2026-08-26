import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { resetDb } from "./helpers.js";

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split(".");
  return JSON.parse(Buffer.from(payload!, "base64").toString("utf8"));
}

async function registerUser(email: string) {
  const res = await request(app).post("/auth/register").send({ email, password: "password123" });
  return res.body as { token: string; user: { id: string; email: string } };
}

beforeEach(async () => {
  await resetDb();
});

describe("GET /health", () => {
  it("reports ok when the database is reachable", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("auth", () => {
  it("signs the JWT with sub and email claims, matching what the frontend decodes", async () => {
    const { token } = await registerUser("alice@example.com");
    const payload = decodeJwtPayload(token);

    expect(payload.sub).toBeTypeOf("string");
    expect(payload.email).toBe("alice@example.com");
  });
});

describe("GET /balance", () => {
  it("returns usdBalance, matching the frontend's expected field name", async () => {
    const { token } = await registerUser("bob@example.com");

    const res = await request(app).get("/balance").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ usdBalance: 0 });
  });
});

describe("list endpoints' response shape", () => {
  it("GET /markets wraps the array under a markets key", async () => {
    const res = await request(app).get("/markets");
    expect(res.body).toEqual({ markets: [] });
  });

  it("GET /positions wraps the array under a positions key", async () => {
    const { token } = await registerUser("carol@example.com");
    const res = await request(app).get("/positions").set("Authorization", `Bearer ${token}`);
    expect(res.body).toEqual({ positions: [] });
  });

  it("POST /history wraps the array under a history key", async () => {
    const { token } = await registerUser("dave@example.com");
    const res = await request(app).post("/history").set("Authorization", `Bearer ${token}`);
    expect(res.body).toEqual({ history: [] });
  });
});

describe("order validation", () => {
  it("rejects out-of-range prices and non-positive quantities", async () => {
    const alice = await registerUser("validation@example.com");
    const market = (
      await request(app)
        .post("/markets")
        .set("Authorization", `Bearer ${alice.token}`)
        .send({ title: "T", description: "D", resolutionDescription: "R" })
    ).body;

    const cases = [
      { price: 0, qty: 10 }, // below 1c
      { price: 100, qty: 10 }, // above 99c
      { price: 50, qty: 0 }, // non-positive qty
      { price: 50, qty: -5 }, // negative qty
    ];

    for (const { price, qty } of cases) {
      const res = await request(app)
        .post("/order")
        .set("Authorization", `Bearer ${alice.token}`)
        .send({ marketId: market.id, side: "yes", type: "buy", price, qty });
      expect(res.status).toBe(411);
    }
  });
});

describe("end-to-end order flow", () => {
  it("matches two orders over HTTP and updates market liquidity (totalQty)", async () => {
    const alice = await registerUser("alice2@example.com");
    const bob = await registerUser("bob2@example.com");

    await request(app).post("/onramp").set("Authorization", `Bearer ${alice.token}`).send({ amount: 100 });
    await request(app).post("/onramp").set("Authorization", `Bearer ${bob.token}`).send({ amount: 100 });

    const market = (
      await request(app)
        .post("/markets")
        .set("Authorization", `Bearer ${alice.token}`)
        .send({ title: "T", description: "D", resolutionDescription: "R" })
    ).body;

    expect(market.totalQty).toBe(0);

    // Alice buys 10 YES @ 60c -> no match, rests as a reverse order.
    const first = await request(app)
      .post("/order")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ marketId: market.id, side: "yes", type: "buy", price: 60, qty: 10 });
    expect(first.status).toBe(200);

    // Bob buys 10 NO @ 40c -> matches Alice's reverse order, minting a pair.
    const second = await request(app)
      .post("/order")
      .set("Authorization", `Bearer ${bob.token}`)
      .send({ marketId: market.id, side: "no", type: "buy", price: 40, qty: 10 });
    expect(second.status).toBe(200);

    const updated = (await request(app).get("/market").query({ marketId: market.id })).body.market;
    expect(updated.totalQty).toBe(20); // 10 YES + 10 NO minted
  });
});

describe("resolution", () => {
  it("pays winners and resets liquidity to zero", async () => {
    const alice = await registerUser("alice3@example.com");
    await request(app).post("/onramp").set("Authorization", `Bearer ${alice.token}`).send({ amount: 10 });

    const market = (
      await request(app)
        .post("/markets")
        .set("Authorization", `Bearer ${alice.token}`)
        .send({ title: "T", description: "D", resolutionDescription: "R" })
    ).body;

    // Split $5 into 500 YES + 500 NO shares.
    await request(app)
      .post("/split")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ marketId: market.id, amount: 500 });

    const afterSplit = (await request(app).get("/market").query({ marketId: market.id })).body.market;
    expect(afterSplit.totalQty).toBe(1000); // 500 YES + 500 NO

    const resolveRes = await request(app)
      .post(`/markets/${market.id}/resolve`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ resolution: "Yes" });
    expect(resolveRes.status).toBe(200);

    const balanceRes = await request(app).get("/balance").set("Authorization", `Bearer ${alice.token}`);
    // Started with $10 (1000c), spent 500c on the split, won 500 YES shares @ 100c = 50000c.
    expect(balanceRes.body.usdBalance).toBe(1000 - 500 + 500 * 100);

    const resolvedMarket = (await request(app).get("/market").query({ marketId: market.id })).body.market;
    expect(resolvedMarket.totalQty).toBe(0);
  });
});
