import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./env.js";
import authRouter from "./auth.js";
import marketsRouter from "./routes/markets.js";
import ordersRouter from "./routes/orders.js";
import splitMergeRouter from "./routes/split-merge.js";
import balanceRouter from "./routes/balance.js";
import positionsRouter from "./routes/positions.js";
import historyRouter from "./routes/history.js";
import resolveRouter from "./routes/resolve.js";

const app = express();

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
app.use(cookieParser());
app.use(express.json());

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/auth", authRouter);
app.use(marketsRouter);       // GET /markets, GET /market, POST /markets
app.use(ordersRouter);        // POST /order
app.use(splitMergeRouter);    // POST /split, POST /merge
app.use(balanceRouter);       // GET /balance, POST /onramp, POST /offramp
app.use(positionsRouter);     // GET /positions
app.use(historyRouter);       // POST /history
app.use(resolveRouter);       // POST /markets/:id/resolve

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(env.PORT, () => {
  console.log(`Server running on http://localhost:${env.PORT}`);
});

export default app;
