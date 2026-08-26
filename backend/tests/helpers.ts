import { v4 as uuid } from "uuid";
import { prisma } from "../src/db.js";

export async function resetDb() {
  await prisma.orderHistory.deleteMany();
  await prisma.position.deleteMany();
  await prisma.market.deleteMany();
  await prisma.user.deleteMany();
}

export async function createUser(usdBalance: number) {
  return prisma.user.create({
    data: {
      email: `${uuid()}@example.com`,
      passwordHash: "unused-in-tests",
      usdBalance,
    },
  });
}

export async function createMarket() {
  return prisma.market.create({
    data: {
      title: "Test market",
      description: "Test market description",
      resolutionDescription: "Test resolution criteria",
    },
  });
}
