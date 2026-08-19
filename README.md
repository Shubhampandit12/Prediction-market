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

The same four-branch logic (yes/buy, yes/sell, no/buy, no/sell) repeats with the sides swapped in `matching.ts`, and it's genuinely repetitive — about 450 lines for what is conceptually one idea applied four ways. That repetition is a real cost of this design: any bug fix to the matching logic has to be applied in up to four places by hand, and there's no shared helper doing the "walk price levels, match orders, credit/debit both sides" loop. Split/merge is the simpler counterpart: it doesn't touch the order books at all, just moves cents into equal YES+NO positions (split) or burns equal YES+NO back into cents (merge), which is how a market can have two-sided liquidity before anyone has actually traded against anyone else.

## 3. Rough edges I found by actually running it

Reading the matching engine convinced me it was correct; running the rest of the app is what turned up the gaps. These aren't hypothetical — I hit each of them with `curl` against a live server before writing this down.

**Every list endpoint wraps its payload, and most of the frontend silently swallows the mismatch.** `GET /markets`, `GET /positions`, and `POST /history` all return `{ markets: [...] }` / `{ positions: [...] }` / `{ history: [...] }` — an object, not a bare array. But `frontend/src/api.ts` types each of these calls as returning `Market[]` / `Position[]` / `OrderHistory[]` directly. Three of the four consumers (`App.tsx`, `Positions.tsx`, `OrderHistory.tsx`) guard against this with `Array.isArray(data) ? data : []`, so instead of a crash you get a silently empty list — the UI just never shows any markets, positions, or history, and there's no error in the console to point at why. TypeScript doesn't catch it because `axios`'s `response.data` is typed `any`.

**`GET /balance` hits the same mismatch with no guard at all.** The backend returns `{ balance: N }`; `Balance.tsx` reads `data.usdBalance / 100` with no fallback, so the balance display always renders `$NaN`.

**The JWT the frontend decodes doesn't have the fields it's looking for.** `backend/src/auth.ts` signs the token as `jwt.sign({ userId: user.id }, ...)`. `frontend/src/hooks/useUser.ts` decodes it looking for `payload.sub` and `payload.email` — neither of which the token contains — so after login `user.email` is always an empty string in the header, even though auth itself works fine (the backend re-verifies the token independently and reads `userId`, which *is* present).

**`Market.totalQty`, shown in the UI as "liquidity," is never updated after creation.** It's set once when a market is created (always 0 through the API; the seed script hardcodes it) and no route — not the matching engine, not split/merge — ever touches it again. Any market created through the app shows "0 shares" of liquidity forever, regardless of how much actually trades.

**The seed script fails out of the box.** `npm run seed` throws `Environment variable not found: DATABASE_URL` unless you export it in your shell first, even with a `.env` file present. The reason: `env.ts` loads `dotenv/config`, but `db.ts` (which `seed.ts` imports directly) doesn't, so the Prisma client seed.ts constructs never sees the `.env` file. `npm run dev` doesn't have this problem because it imports `env.ts` first, which pulls in `dotenv/config` as a side effect.

None of these are in the matching engine itself, which is the part I actually verified carries the interesting logic correctly. They're contract mismatches between what the backend sends and what the frontend expects — the kind of thing that's invisible until you actually run both halves together and click around, which is exactly what I did before writing this list.

## 4. Stack

Backend: Node 18+, Express 4, TypeScript (ESM), Prisma 5 against SQLite, Zod for request validation, JWT (`jsonwebtoken`) + `bcryptjs` for auth. Frontend: React 19 + Vite 6 + TypeScript, Axios, no state library — hooks and prop drilling. A root-level `npm run dev` boots both via `concurrently`. No Docker, no Postgres, no paid services — everything runs on one machine.

I ran `tsc --noEmit` on the backend and `tsc -b && vite build` on the frontend; both are clean with no type errors. There's no automated test suite (no Jest/Vitest config, no test files) — verification here was done by running the actual server and hitting real endpoints with `curl`, as described above.

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

# seed.ts imports db.ts directly, which doesn't load dotenv — export DATABASE_URL
# yourself or `npm run seed` will fail with "Environment variable not found: DATABASE_URL"
export DATABASE_URL="file:./prisma/dev.db"
npm run seed

cd ../frontend
npm install

cd ..
npm run dev                      # backend on :3000, frontend on :5173
```

Open http://localhost:5173. The seed script (`backend/src/seed.ts`) creates 5 markets and 3 users — `alice@example.com`, `bob@example.com`, `charlie@example.com`, all with password `password123`, starting balances $100 / $150 / $200 respectively — and pre-populates order-book liquidity on the first two markets so there's something to look at immediately.

## 6. Project layout

```
Prediction-market/
├── package.json                  # root: npm run dev via concurrently
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma         # User, Market, Position, OrderHistory
│   │   └── migrations/
│   └── src/
│       ├── index.ts              # Express app, route wiring
│       ├── env.ts                # zod-validated env vars (loads dotenv)
│       ├── db.ts                 # Prisma client singleton (no dotenv import)
│       ├── auth.ts                # /auth/register, /auth/login, /auth/logout
│       ├── middleware.ts         # JWT verification -> req.userId
│       ├── matching.ts           # the CLOB engine, ~450 lines, 4 branches
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
        ├── api.ts                 # axios wrapper for every backend route
        ├── hooks/useUser.ts        # decodes the JWT client-side for display
        └── components/
            ├── MarketList.tsx, MarketDetail.tsx, OrderForm.tsx
            ├── SplitMerge.tsx, Positions.tsx, OrderHistory.tsx
            ├── Balance.tsx, CreateMarket.tsx, ResolveMarket.tsx
```

## 7. License

MIT.
