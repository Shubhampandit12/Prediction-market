import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.string().default("3000").transform(Number),
  JWT_SECRET: z.string().default("dev-secret"),
  DATABASE_URL: z.string().default("file:./prisma/dev.db"),
  FRONTEND_URL: z.string().default("http://localhost:5173"),
});

export const env = envSchema.parse(process.env);
