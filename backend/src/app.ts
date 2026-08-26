import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./env.js";
import { prisma } from "./db.js";
import authRouter from "./auth.js";
import marketsRouter from "./routes/markets.js";
import ordersRouter from "./routes/orders.js";
import splitMergeRouter from "./routes/split-merge.js";
import balanceRouter from "./routes/balance.js";
import positionsRouter from "./routes/positions.js";
import historyRouter from "./routes/history.js";
import resolveRouter from "./routes/resolve.js";

const app = express();

// The Docker image copies the built frontend to ../public next to dist/.
// In dev (tsx running straight from src/) that directory doesn't exist, so
// the frontend is served separately by its own Vite dev server instead.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDistPath = path.join(currentDir, "../public");
const servesFrontend = fs.existsSync(frontendDistPath);

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
app.use(cookieParser());
app.use(express.json());

if (servesFrontend) {
  app.use(express.static(frontendDistPath));
}

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
// Checks real DB connectivity, not just that the process is up — a readiness
// probe that only proves Express is listening would still report healthy
// while every request 500s on a lost DB connection.
app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "error", message: "database unreachable" });
  }
});

// SPA fallback: this app has no client-side routing, but serving index.html
// for unmatched GET requests is what makes a browser refresh/deep link work
// instead of 404ing. Registered last so it never shadows an API route above.
if (servesFrontend) {
  app.get("*", (_req, res) => {
    res.sendFile(path.join(frontendDistPath, "index.html"));
  });
}

export default app;
