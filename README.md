# Prediction Market Clone

A free, self-hostable, fully studiable Polymarket-style prediction market application featuring a central limit order book (CLOB) matching engine, binary YES/NO shares priced in cents, pair-minting via reverse orders, split/merge primitives, market creation, and market resolution with automatic settlement. Built as a portfolio project to demonstrate real-time financial matching logic without any paid dependencies. Inspired by and credited to [Harkirat Singh's prediction-market repo](https://github.com/hkirat/prediction-market).

---

## Features

| Feature | Description |
|---------|-------------|
| **CLOB Matching Engine** | Limit-order book with price-time priority, cheapest-first matching |
| **YES + NO = 100c Invariant** | Binary outcome shares always sum to $1.00 |
| **Reverse-Order Pair Minting** | Unmatched buys post on the opposite book; when matched, the system mints a new YES+NO pair from thin air |
| **Split / Merge** | Atomic basket primitive: split $1 into 1 YES + 1 NO, or merge them back |
| **Market Creation** | Any authenticated user can create new binary markets |
| **Market Resolution & Settlement** | Resolve a market as YES or NO; winners auto-credited at $1/share, positions cleared |
| **Email/Password Auth** | JWT-based authentication (no wallet, no third-party OAuth) |
| **Onramp / Offramp** | Simulated fiat on/off-ramp for demo purposes |
| **Order History** | Full audit trail of buys, sells, splits, merges, and settlements |
| **Positions Dashboard** | Live view of user's open positions across all markets |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (:5173)                          │
│  React 19 + Vite + TypeScript + hand-rolled dark CSS            │
│  ┌────────────┐ ┌────────────┐ ┌───────────┐ ┌──────────────┐  │
│  │ MarketList │ │MarketDetail│ │ OrderForm │ │ SplitMerge   │  │
│  └────────────┘ └────────────┘ └───────────┘ └──────────────┘  │
│  ┌────────────┐ ┌────────────┐ ┌───────────┐ ┌──────────────┐  │
│  │ Positions  │ │OrderHistory│ │  Balance  │ │CreateMarket  │  │
│  └────────────┘ └────────────┘ └───────────┘ └──────────────┘  │
└───────────────────────────┬─────────────────────────────────────┘
                            │ axios (JSON over HTTP)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Express API (:3000)                          │
│  Node 18+ / Express 4 / TypeScript (ESM)                        │
│  ┌──────┐ ┌──────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐  │
│  │ auth │ │orders│ │split-merge│ │  resolve │ │  markets    │  │
│  └──────┘ └──────┘ └──────────┘ └──────────┘ └─────────────┘  │
│                    ┌──────────────────┐                          │
│                    │  matching.ts     │ <-- CLOB engine          │
│                    └────────┬─────────┘                          │
│                             │ Prisma ORM                         │
└─────────────────────────────┼───────────────────────────────────┘
                              ▼
                   ┌─────────────────────┐
                   │   SQLite (dev.db)   │
                   │  Users, Markets,    │
                   │  Positions, Orders  │
                   └─────────────────────┘
```

### Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React 19, Vite 6, TypeScript 5 | Single-page app, dark UI |
| HTTP Client | Axios | Token stored in localStorage |
| Backend | Node 18+, Express 4, TypeScript (ESM) | Hot-reload via tsx |
| ORM | Prisma 5 | Type-safe DB access |
| Database | SQLite | Zero-config, file-based |
| Auth | JWT (jsonwebtoken) + bcryptjs | Stateless, bearer token |
| Validation | Zod | Runtime schema checks on every endpoint |
| Monorepo | npm workspaces + concurrently | Single `npm run dev` boots both |

---

## How the Matching Engine Works

This is the intellectual core of the project -- the thing worth discussing in a technical interview.

### 1. Prices in Cents (1-99), YES + NO = 100

Every market is a binary question. A YES share and a NO share always sum to 100 cents ($1.00). If YES trades at 62c, the implied NO price is 38c. At resolution, the winning side pays out $1.00 per share; the losing side pays $0.00.

### 2. The Order Book Shape

Each market has two order books (stored as JSON in SQLite):

```
yesOrderbook: { [price: string]: { availableQty, orders[] } }
noOrderbook:  { [price: string]: { availableQty, orders[] } }
```

Each price level holds a FIFO queue of orders. Orders can be either **direct** (user is selling a share they own) or **reverse** (a synthetic ask placed by the engine when a buy went unmatched).

### 3. Standard Matching: Cheapest-First

When a BUY YES @ 62c arrives, the engine scans the YES sell side from the lowest asking price upward. Any ask at or below 62c is matched:

```
Buyer wants:  5 YES @ 62c
Sell book:    3 YES @ 60c, 4 YES @ 62c

Result:
  - Match 3 @ 60c (buyer pays 60c each, seller delivers existing YES shares)
  - Match 2 @ 62c (buyer pays 62c each, seller delivers existing YES shares)
  - Buyer now holds 5 YES shares
```

### 4. The Reverse-Order Mechanism (Pair-Minting)

This is the clever part. When a buy has leftover quantity after scanning the same-side book, the engine does NOT simply rest the order on the same book. Instead:

> **It posts a REVERSE order on the OPPOSITE book at (100 - price).**

When that reverse order is later matched, the system MINTS a fresh YES+NO pair from nothing (since YES + NO = $1.00, no value is created or destroyed).

#### Concrete Example

```
1. Alice submits: BUY 10 YES @ 60c
   - The YES sell book is empty. No match.
   - Engine posts a REVERSE order on the NO book: SELL 10 NO @ 40c
     (because 100 - 60 = 40)

2. Bob submits: BUY 10 NO @ 40c
   - Engine scans the NO sell book, finds Alice's reverse order at 40c.
   - MATCH! But this is a reverse order, so instead of transferring
     existing NO shares, the system MINTS a new pair:

     Alice gets: 10 YES shares (she paid 60c each = $6.00 total)
     Bob gets:   10 NO shares  (he paid 40c each = $4.00 total)
     Total cost: $6.00 + $4.00 = $10.00 = 10 pairs * $1.00 per pair

   Conservation holds: 10 YES + 10 NO minted, funded by exactly $10.
```

This mechanism means liquidity can exist even with zero pre-existing shares -- two opposing bettors create the market simply by placing orders.

### 5. Split and Merge: The Atomic Basket Primitive

**Split**: Pay N cents, receive N YES shares + N NO shares. This is how a market maker can bootstrap both sides of the book without taking directional risk.

**Merge**: Burn N YES + N NO shares, receive N cents back. This lets a trader exit a hedged position or arbitrage a mispricing.

```
Split $5.00:   -500c balance  -->  +500 YES, +500 NO
Merge 200:     -200 YES, -200 NO  -->  +200c balance
```

Together, split/merge + the reverse-order mechanism form a complete system: shares can be created (split or pair-mint), transferred (order matching), and destroyed (merge or resolution).

### 6. Settlement (Resolution)

When a market resolves:
1. The winning side (YES or NO) pays out 100c per share.
2. The losing side pays out 0c.
3. All positions are deleted; both order books are cleared.

---

## Prerequisites

- **Node.js 18+** (tested on 20 and 22)
- **npm** (comes with Node)

No Docker, no Postgres, no Redis, no paid services.

---

## Getting Started

```bash
# 1. Clone the repo
git clone <your-repo-url> prediction-market-clone
cd prediction-market-clone

# 2. Install root dependencies (concurrently)
npm install

# 3. Install backend dependencies
cd backend
npm install

# 4. Generate Prisma client + run migrations
npx prisma generate
npx prisma migrate dev --name init

# 5. Seed the database (5 markets, 3 users, orderbook liquidity)
npm run seed

# 6. Install frontend dependencies
cd ../frontend
npm install

# 7. Run both servers (from project root)
cd ..
npm run dev
```

Open http://localhost:5173 in your browser. The backend API is at http://localhost:3000.

### Seeded Users (for quick login)

| Email | Password | Starting Balance |
|-------|----------|-----------------|
| alice@test.com | password123 | $100.00 (10000c) |
| bob@test.com | password123 | $100.00 (10000c) |
| carol@test.com | password123 | $100.00 (10000c) |

---

## How It Differs from the Original

| Aspect | Original (hkirat/prediction-market) | This Clone |
|--------|-------------------------------------|------------|
| Auth | Supabase Auth (Google OAuth) | Email/password + JWT |
| Database | PostgreSQL (via Supabase) | SQLite (zero-config, portable) |
| ORM | Direct Supabase client | Prisma 5 with typed queries |
| User Identity | Wallet-based | Email-based |
| Market Creation | Not supported | Full CRUD via `/markets` endpoint |
| Resolution / Settlement | Not implemented | Full resolution with winner payout |
| Hosting Dependencies | Supabase project required | Fully self-contained, runs offline |
| Frontend Framework | React + Next.js | React 19 + Vite (no SSR needed) |
| State Management | Recoil | Hooks + prop drilling (simpler) |
| Deployment | Vercel + Supabase | Single machine, `npm run dev` |

---

## 2-Week Study Roadmap

A dependency-ordered reading plan for understanding (and being able to explain) every piece of this system in an interview.

| Day | Focus | Files to Read | What You Should Understand After |
|-----|-------|---------------|----------------------------------|
| 1 | Database Schema | `backend/prisma/schema.prisma` | The four tables (User, Market, Position, OrderHistory), their relations, the `@@unique` constraint on positions, orderbooks stored as JSON strings |
| 2 | Shared Types & Validation | `backend/src/types.ts` | The Orderbook type shape, Zod schemas for every endpoint, why `price` and `qty` are integers (cents, not dollars) |
| 3 | Auth Flow | `backend/src/auth.ts`, `backend/src/middleware.ts` | JWT creation, bcrypt hashing, the `requireAuth` middleware that sets `req.userId` |
| 4-5 | The Matching Engine (core) | `backend/src/matching.ts` | All four branches (yes/buy, yes/sell, no/buy, no/sell), how reverse orders post on the opposite book, how pair-minting works, the cheapest-first sort |
| 6 | Split / Merge | `backend/src/routes/split-merge.ts` | The basket primitive, conservation of value, how it enables market-making |
| 7 | Resolution & Settlement | `backend/src/routes/resolve.ts` | Winner payout logic (qty * 100c), position deletion, orderbook clearing |
| 8 | Order Placement Route | `backend/src/routes/orders.ts` | How the route wraps `executeOrder` in a Prisma `$transaction`, balance checks, response shape |
| 9 | Frontend API Contract | `frontend/src/api.ts`, `frontend/src/types.ts` | Every endpoint the frontend calls, token management in localStorage, request/response shapes |
| 10 | MarketDetail + OrderForm | `frontend/src/components/MarketDetail.tsx`, `frontend/src/components/OrderForm.tsx` | How the UI renders the orderbook, price display logic, form submission, error handling |
| 11 | Remaining Components | `frontend/src/components/` (all remaining) | Positions, Balance, CreateMarket, ResolveMarket, SplitMerge, OrderHistory |
| 12 | Seed Script & E2E Flow | `backend/src/seed.ts` | How test data is created, how orderbook JSON is built programmatically |
| 13 | Edge Cases & Invariants | Re-read `matching.ts` with focus on edge cases | What happens with partial fills, self-matching prevention (or lack thereof), zero-quantity cleanup |
| 14 | Whiteboard Practice | None (close the editor) | Draw the matching engine from memory, walk through the Alice/Bob pair-minting example, explain split/merge, explain settlement |

---

## Known Limitations

- **No real money.** The onramp/offramp is simulated -- no payment processor integration.
- **No order cancellation.** Once an order rests on the book, it stays until matched or the market resolves.
- **No time-series price chart.** There is no historical price tracking or candlestick data.
- **Single-server, not horizontally scalable.** SQLite serializes writes; this is a demo, not production infrastructure.
- **No WebSocket push.** The frontend polls on navigation; there are no real-time orderbook updates.
- **No partial-fill notifications.** If an order partially fills and the rest goes to the book, the user only sees the final state.
- **Self-trade is not prevented.** A user can technically match their own orders.
- **No admin role.** Any authenticated user can resolve any market (suitable for demo; would need RBAC in production).

---

## Project Structure

```
prediction-market-clone/
├── package.json              # Root monorepo scripts (dev, dev:backend, dev:frontend)
├── backend/
│   ├── package.json          # Express + Prisma + JWT dependencies
│   ├── prisma/
│   │   ├── schema.prisma     # Database schema (4 models)
│   │   └── dev.db            # SQLite database file (after migration)
│   └── src/
│       ├── index.ts          # Express app setup, route registration
│       ├── db.ts             # Prisma client singleton
│       ├── env.ts            # Environment config (PORT, JWT_SECRET, DATABASE_URL)
│       ├── auth.ts           # /auth/register, /auth/login endpoints
│       ├── middleware.ts     # JWT verification middleware
│       ├── matching.ts       # CLOB matching engine (the heart of the app)
│       ├── types.ts          # Zod schemas + TypeScript types
│       ├── seed.ts           # Database seeder (users, markets, orderbook liquidity)
│       └── routes/
│           ├── orders.ts     # POST /order (delegates to matching engine)
│           ├── markets.ts    # GET /markets, GET /market, POST /markets
│           ├── resolve.ts    # POST /markets/:id/resolve (settlement)
│           ├── split-merge.ts# POST /split, POST /merge
│           ├── balance.ts    # GET /balance, POST /onramp, POST /offramp
│           ├── positions.ts  # GET /positions
│           └── history.ts    # POST /history (order audit trail)
└── frontend/
    ├── package.json          # React 19 + Vite + Axios
    └── src/
        ├── main.tsx          # React entry point
        ├── App.tsx           # Root component with routing/state
        ├── api.ts            # Axios wrapper for all backend endpoints
        ├── types.ts          # Frontend TypeScript interfaces
        ├── App.css           # Dark theme styles
        ├── index.css         # Global CSS reset
        ├── hooks/
        │   └── useUser.ts    # Auth state hook
        └── components/
            ├── MarketList.tsx    # Browse all markets
            ├── MarketDetail.tsx  # Single market view with orderbook
            ├── OrderForm.tsx     # Buy/sell order form
            ├── SplitMerge.tsx    # Split/merge interface
            ├── Positions.tsx     # User's open positions
            ├── OrderHistory.tsx  # Trade history table
            ├── Balance.tsx       # Balance + onramp/offramp
            ├── CreateMarket.tsx  # New market form
            └── ResolveMarket.tsx # Market resolution controls
```

---

## License

MIT. Use it, study it, put it on your CV.
