import "dotenv/config";
import { z } from "zod";

const isProd = process.env.NODE_ENV === "production";

// In dev/test these all have safe defaults so the app runs with zero setup.
// In production every one of them must be explicitly and properly set —
// silently falling back to "dev-secret" or localhost in a real deploy is
// exactly the kind of thing that's invisible until someone exploits it.
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().default("3000").transform(Number),
  JWT_SECRET: isProd
    ? z
        .string()
        .min(16, "JWT_SECRET must be a real secret (16+ chars) in production")
        .refine((v) => v !== "dev-secret", "JWT_SECRET must not use the dev default in production")
    : z.string().default("dev-secret"),
  DATABASE_URL: isProd
    ? z.string().min(1, "DATABASE_URL must be set in production")
    // Relative to prisma/schema.prisma's own directory, not cwd — this
    // resolves to backend/prisma/dev.db. See .env.example for why the
    // "prisma/" segment isn't repeated here.
    : z.string().default("file:./dev.db"),
  FRONTEND_URL: isProd
    ? z.string().url("FRONTEND_URL must be a valid URL in production")
    : z.string().default("http://localhost:5173"),
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Invalid environment configuration:");
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
