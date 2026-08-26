import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(dirname, "..");
const testDbPath = path.join(dirname, "test.db");

// Point every module that reads DATABASE_URL (db.ts, env.ts) at an isolated
// SQLite file before anything imports them, so tests never touch dev.db.
process.env.DATABASE_URL = `file:${testDbPath}`;
process.env.JWT_SECRET = "test-secret";
process.env.FRONTEND_URL = "http://localhost:5173";

execSync("npx prisma db push --skip-generate --accept-data-loss", {
  cwd: backendRoot,
  env: process.env,
  stdio: "inherit",
});
