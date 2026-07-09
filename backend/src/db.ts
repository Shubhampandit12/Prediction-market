import { PrismaClient } from "@prisma/client";

// Singleton PrismaClient instance for the application
export const prisma = new PrismaClient();
