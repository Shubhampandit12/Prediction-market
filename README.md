# Prediction Market

A self-hosted clone of a Polymarket-style binary prediction market: a central limit order book (CLOB), YES/NO shares priced in cents, and the "reverse order" mechanism that lets two opposing bettors mint a new share pair out of nothing. I built it to actually understand how a CLOB-based prediction market works mechanically, not just conceptually — the kind of thing that's easy to nod along to in a blog post and much harder to get right when you're the one writing the balance updates. It's a rebuild of [hkirat/prediction-market](https://github.com/hkirat/prediction-market), swapped onto a stack that runs with zero external services: SQLite instead of Supabase/Postgres, email/password JWT auth instead of OAuth, and a from-scratch resolution/settlement flow the original didn't have.

## 1. What it does

Users register with email/password, get a JWT, and can then trade binary markets ("Will X happen by Y?"). Every market has two independent order books, one for YES shares and one for NO, both stored as JSON blobs on the `Market` row (`{ "62": { availableQty: 150, orders: [...] } }`, keyed by price in cents). Orders are limit orders only — buy or sell, YES or NO, at a price from 1 to 99 cents. Matching happens synchronously inside a Prisma transaction, so a placed order is either fully accounted for (balances and positions updated) or it fails outright; there's no async settlement step.

On top of ordinary limit-order matching there are two other primitives: split (pay N cents, receive N YES + N NO shares) and merge (burn N YES + N NO, get N cents back), and market resolution (an authenticated user marks a market YES or NO, winning positions get paid 100c/share, everything else is zeroed out). None of this touches real money — the onramp/offramp endpoints just increment or decrement a balance column.

## 2. The matching engine, and why it's the interesting part

The core invariant is that a YES share and a NO share always sum to 100 cents. If YES is worth 62c, NO is implicitly worth 38c, because together they represent "$1 if this resolves, paid to whoever's right."

The mechanism that keeps that invariant alive without a market maker is what the original project calls a reverse order. When a buy order can't be fully filled from the matching side of the book, the engine doesn't rest the leftover quantity on the same book — it posts a synthetic sell order on the *opposite* book, at `100 - price`. If that synthetic order later gets matched by someone buying the opposite side, the system doesn't transfer existing shares between two people (there aren't any) — it mints a brand new YES+NO pair, funded by both traders' cash.

I traced this end-to-end against a running instance rather than just reading the code, because the "conservation of value" claim is exactly the kind of thing that's easy to get subtly wrong in the accounting:

```
1. Fresh market, empty order books. Alice (authenticated, funded) submits BUY 10 YES @ 60c.
   -> No YES asks exist, so nothing matches.
   -> Engine posts a reverse order on the NO book at 100 - 60 = 40c:
      noOrderbook["40"] = { availableQty: 10, orders: [{ userId: alice, reverseOrder: true, qty: 10 }] }

2. Bob (different account) submits BUY 10 NO @ 40c.
   -> Engine finds Alice's reverse order on the NO book at 40c and matches it.
   -> Because it's a reverse order, the engine mints a new pair instead of transferring shares:
        Alice's balance -= 600  (10 * 60c, charged when her order first posted... functionally settled here)
        Bob's balance   -= 400  (10 * 40c)
        Alice's position: +10 YES
        Bob's position:   +10 NO

Result confirmed via the running API: Alice ends up with exactly 10 YES, Bob with exactly
10 NO, and the combined debit is exactly 1000 cents = 10 pairs * 100c/pair. Both order
books are empty again afterward. Conservation holds exactly, to the cent, with real
requests against a real SQLite-backed server — not just by reading the arithmetic.
```

The same four-branch logic (yes/buy, yes/sell, no/buy, no/sell) used to repeat with the sides swapped in `matching.ts` — about 450 lines for what is conceptually one idea applied four ways. It's since been collapsed into one code path (~210 lines) built on an invariant that wasn't obvious until you trace all four branches side by side: whichever book an order rests on always matches the type of shares its non-reverse sellers hold, regardless of whether the walking order is a buy or a sell — so "which book to walk" and "what position a match affects" reduce to two facts (buy-or-sell, which side) instead of four hand-written branches. The matching-engine tests below pass unchanged before and after that refactor. Split/merge is the simpler counterpart: it doesn't touch the order books at all, just moves cents into equal YES+NO positions (split) or burns equal YES+NO back into cents (merge), which is how a market can have two-sided liquidity before anyone has actually traded against anyone else.

## 3. Rough edges I found — and fixed

Reading the matching engine convinced me it was correct; running the rest of the app is what turned up the gaps. These aren't hypothetical — I hit each of them with `curl` against a live server before writing this down, and there's now a regression test locking in each fix (see `backend/tests/`).

**Every list endpoint wrapped its payload, and most of the frontend silently swallowed the mismatch.** `GET /markets`, `GET /positions`, and `POST /history` return `{ markets: [...] }` / `{ positions: [...] }` / `{ history: [...] }` — an object, not a bare array. `frontend/src/api.ts` now unwraps each of these at the one seam where they're consumed, so every caller gets the real array it always claimed to return, instead of relying on `Array.isArray(data) ? data : []` guards to fail silently — those guards are gone now that the contract is actually honored.

**`GET /balance` had the same mismatch with no guard at all.** The backend returned `{ balance: N }`; `Balance.tsx` read `data.usdBalance / 100` with no fallback, so the display always rendered `$NaN`. Fixed by renaming the backend field to `usdBalance` (matching what the frontend — and its own type signature — already expected), plus a `?? 0` fallback.

**The JWT the frontend decoded didn't have the fields it was looking for.** The token was signed as `jwt.sign({ userId: user.id }, ...)`; `useUser.ts` decoded it looking for `payload.sub`/`payload.email`, neither of which existed, so `user.email` was always blank in the header. Fixed by signing with proper `sub`/`email` claims and updating `middleware.ts` to read `sub`.

**`Market.totalQty` ("liquidity" in the UI) was never updated after creation.** It's now real open interest: incremented when a reverse order actually gets matched (a new pair is minted) or a market is split, decremented on merge, reset to 0 on resolution. Resting-but-unmatched reverse orders don't count, since no shares exist yet at that point.

**The seed script failed out of the box** with `Environment variable not found: DATABASE_URL`, because `db.ts` (which `seed.ts` imports directly) never loaded `dotenv`, unlike `env.ts`. Fixed by importing `dotenv/config` at the top of `db.ts`.

**Smaller hardening pass:** price/quantity bounds and self-trade prevention (a user's order no longer matches their own resting order) in the matching engine; rate limiting on `/auth/*`; input bounds on split/onramp/offramp amounts.

## 4. Stack

Backend: Node 18+, Express 4, TypeScript (ESM), Prisma 5 against SQLite, Zod for request validation, JWT (`jsonwebtoken`) + `bcryptjs` for auth. Frontend: React 19 + Vite 6 + TypeScript, Axios, no state library — hooks and prop drilling. A root-level `npm run dev` boots both via `concurrently`.

`tsc --noEmit` is clean on both backend and frontend. The backend has an actual test suite now (Vitest + Supertest, `backend/tests/`): unit tests drive the matching engine directly against a real transactional SQLite connection (full fill, partial fill, reverse-order minting reproducing the trace above, empty books, a resting order matched by a later independent call, self-trade prevention), and integration tests hit the real Express app for the four contract bugs, an end-to-end order flow, resolution/payout, and input validation. Run it with `cd backend && npm test`.

## 5. Running it

```bash
git clone https://github.com/Shubhampandit12/Prediction-market.git
cd Prediction-market

npm install                      # root: installs `concurrently`

cd backend
npm install
cp .env.example .env
npx prisma generate
npx prisma migrate deploy        # or: npx prisma migrate dev --name init
npm run seed

cd ../frontend
npm install

cd ..
npm run dev                      # backend on :3000, frontend on :5173
```

Open http://localhost:5173. The seed script (`backend/src/seed.ts`) creates 5 markets and 3 users — `alice@example.com`, `bob@example.com`, `charlie@example.com`, all with password `password123`, starting balances $100 / $150 / $200 respectively — and pre-populates order-book liquidity on the first two markets so there's something to look at immediately.

> **Seed data only.** These accounts and password exist purely so a local checkout has something to click around with. If you ever deploy this anywhere reachable from the internet, reseed with your own data (or drop the seeded users) first — anyone who reads this README otherwise has valid login credentials against your instance.

## 6. Deployment

The backend can serve the built frontend directly from one image — no separate frontend host, no CORS to configure in production, one process to deploy.

```bash
docker build -t prediction-market .
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  -e JWT_SECRET="$(openssl rand -base64 32)" \
  -e DATABASE_URL="file:/data/prod.db" \
  -e FRONTEND_URL="http://localhost:3000" \
  -v prediction-market-data:/data \
  prediction-market
```

Open http://localhost:3000 — that's the whole app, frontend and API, from one container. The `-v` volume mount matters: without it, the SQLite file lives inside the container's own writable layer, which most PaaS free tiers (Render, Fly.io) wipe on every redeploy, silently losing all data.

**Fly.io** is the deploy target this repo is set up for (`fly.toml`), specifically because it has first-class persistent volumes — Render's free tier doesn't:

```bash
fly launch --no-deploy         # picks up fly.toml; rename the `app` field first
fly volumes create prediction_market_data --region iad --size 1
fly secrets set JWT_SECRET="$(openssl rand -base64 32)"
fly deploy
```

After the first deploy, update `FRONTEND_URL` in `fly.toml` to your real `*.fly.dev` URL (or custom domain) and redeploy — it's needed for CORS/cookies to work correctly, and `env.ts` will refuse to boot in production with a missing or invalid value.

**Caveat worth knowing:** Fly volumes are per-machine, not shared or replicated. This setup is correct for exactly one machine (`min_machines_running = 1`, no autoscaling past that) — scale to a second machine and each would get its own separate, diverging SQLite file. If you outgrow a single machine, the fix isn't more volumes, it's switching the datasource: change `provider` in `prisma/schema.prisma` from `sqlite` to `postgresql`, point `DATABASE_URL` at a managed Postgres instance (Fly Postgres, Render, Supabase, etc.), and regenerate the migration — the schema itself is plain enough (`String`, `Int`, `DateTime`) that nothing else needs to change.

`GET /health` checks real database connectivity (not just that Express is up) and is wired into `fly.toml` as the platform's readiness probe.

## 7. Project layout

```
Prediction-market/
├── package.json                  # root: npm run dev via concurrently
├── Dockerfile                    # multi-stage: builds frontend + backend, single runtime image
├── fly.toml                      # Fly.io deploy config (persistent volume for SQLite)
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma         # User, Market, Position, OrderHistory
│   │   └── migrations/
│   ├── tests/                    # Vitest + Supertest
│   │   ├── matching.test.ts      # matching engine, against a real transactional SQLite conn
│   │   ├── routes.test.ts        # integration tests against the real Express app
│   │   ├── helpers.ts, vitest.setup.ts
│   └── src/
│       ├── app.ts                # Express app: middleware, routes, static frontend + SPA fallback
│       ├── index.ts              # entrypoint: imports app.ts, calls app.listen
│       ├── env.ts                # zod-validated env vars; fails loudly in production
│       ├── db.ts                 # Prisma client singleton (loads dotenv)
│       ├── auth.ts                # /auth/register, /auth/login, /auth/logout (rate-limited)
│       ├── middleware.ts         # JWT verification -> req.userId
│       ├── matching.ts           # the CLOB engine, one shared code path for all 4 order variants
│       ├── types.ts              # Zod schemas + Orderbook type
│       ├── seed.ts               # demo data
│       └── routes/
│           ├── orders.ts         # POST /order -> matching.ts, in a transaction
│           ├── markets.ts        # GET/POST /markets, GET /market
│           ├── split-merge.ts    # POST /split, POST /merge
│           ├── resolve.ts        # POST /markets/:id/resolve -> settlement
│           ├── balance.ts        # GET /balance, POST /onramp, /offramp
│           ├── positions.ts      # GET /positions
│           └── history.ts        # POST /history
└── frontend/
    └── src/
        ├── App.tsx                # tab-based layout, auth gate
        ├── api.ts                 # axios wrapper for every backend route (relative URLs in prod)
        ├── hooks/useUser.ts        # decodes the JWT client-side for display
        └── components/
            ├── MarketList.tsx, MarketDetail.tsx, OrderForm.tsx
            ├── SplitMerge.tsx, Positions.tsx, OrderHistory.tsx
            ├── Balance.tsx, CreateMarket.tsx, ResolveMarket.tsx
```

## 8. License

MIT.
