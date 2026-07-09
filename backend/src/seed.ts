/**
 * Seed script: creates 5 markets, 3 users, and populates liquidity
 * on markets[0] and markets[1] — faithfully reproducing the original.
 *
 * Users use email/password auth with pre-hashed bcrypt passwords.
 * Password for all seed users: "password123"
 */

import { prisma } from "./db.js";
import { v4 as uuid } from "uuid";

// Pre-hashed bcrypt for "password123" (10 rounds)
const PASSWORD_HASH = "$2a$10$rQEYlz8RFHmKJ1RJH1K3BOQnGiAH5PBMxJvJxz2qDvBbXRl1xY5i6";

const markets = [
  {
    id: uuid(),
    title: "Will Bitcoin reach $100,000 by end of 2025?",
    description:
      "This market resolves to Yes if Bitcoin trades at or above $100,000 on any major exchange before December 31, 2025.",
    resolutionDescription:
      "Based on Bitcoin price on CoinMarketCap or similar major exchange",
    yesOrderbook: "{}",
    noOrderbook: "{}",
    totalQty: 0,
  },
  {
    id: uuid(),
    title: "Will AI pass Turing test by 2026?",
    description:
      "This market resolves to Yes if an AI system is widely recognized as passing the Turing test by end of 2026.",
    resolutionDescription:
      "Based on consensus from major AI research organizations",
    yesOrderbook: "{}",
    noOrderbook: "{}",
    totalQty: 0,
  },
  {
    id: uuid(),
    title: "Will SpaceX land humans on Mars by 2030?",
    description:
      "This market resolves to Yes if SpaceX successfully lands humans on Mars before January 1, 2030.",
    resolutionDescription:
      "Based on official SpaceX announcements and independent verification",
    yesOrderbook: "{}",
    noOrderbook: "{}",
    totalQty: 0,
  },
  {
    id: uuid(),
    title: "Will Ethereum 2.0 be fully implemented by 2025?",
    description:
      "This market resolves to Yes if Ethereum completes its full transition to proof-of-stake and all planned upgrades by end of 2025.",
    resolutionDescription:
      "Based on official Ethereum Foundation announcements",
    yesOrderbook: "{}",
    noOrderbook: "{}",
    totalQty: 0,
  },
  {
    id: uuid(),
    title: "Will a COVID-19 vaccine be available by 2025?",
    description:
      "This market resolves to Yes if an FDA-approved COVID-19 vaccine is available to the public by end of 2025.",
    resolutionDescription: "Based on FDA approval announcements",
    yesOrderbook: "{}",
    noOrderbook: "{}",
    totalQty: 0,
  },
];

const users = [
  {
    id: uuid(),
    email: "alice@example.com",
    passwordHash: PASSWORD_HASH,
    usdBalance: 10000, // $100.00
  },
  {
    id: uuid(),
    email: "bob@example.com",
    passwordHash: PASSWORD_HASH,
    usdBalance: 15000, // $150.00
  },
  {
    id: uuid(),
    email: "charlie@example.com",
    passwordHash: PASSWORD_HASH,
    usdBalance: 20000, // $200.00
  },
];

async function seed() {
  console.log("Starting seed...");

  // Clean existing data
  await prisma.orderHistory.deleteMany();
  await prisma.position.deleteMany();
  await prisma.market.deleteMany();
  await prisma.user.deleteMany();

  console.log("Creating markets...");
  for (const market of markets) {
    await prisma.market.create({ data: market });
  }

  console.log("Creating users...");
  for (const user of users) {
    await prisma.user.create({ data: user });
  }

  // Create sample positions and orders
  const market = markets[0]!;
  const user1 = users[0]!;
  const user2 = users[1]!;
  const user3 = users[2]!;

  console.log("Creating sample positions...");
  // User1 buys Yes shares in market 1
  await prisma.position.create({
    data: { userId: user1.id, marketId: market.id, type: "Yes", qty: 50 },
  });

  // User2 buys No shares in market 1
  await prisma.position.create({
    data: { userId: user2.id, marketId: market.id, type: "No", qty: 30 },
  });

  // Create order history
  console.log("Creating sample order history...");
  await prisma.orderHistory.create({
    data: {
      id: uuid(),
      orderType: "Buy",
      userId: user1.id,
      marketId: market.id,
      price: 60,
      qty: 50,
    },
  });

  await prisma.orderHistory.create({
    data: {
      id: uuid(),
      orderType: "Buy",
      userId: user2.id,
      marketId: market.id,
      price: 40,
      qty: 30,
    },
  });

  // Update orderbooks with proper pricing (Yes + No >= 100 to prevent arbitrage)
  const yesOrderbook = {
    "62": {
      availableQty: 150,
      orders: [
        { userId: user1.id, qty: 75, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
        { userId: user2.id, qty: 75, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
      ],
    },
    "66": {
      availableQty: 120,
      orders: [
        { userId: user3.id, qty: 60, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
        { userId: user1.id, qty: 60, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
      ],
    },
    "70": {
      availableQty: 100,
      orders: [
        { userId: user2.id, qty: 50, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
        { userId: user3.id, qty: 50, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
      ],
    },
    "74": {
      availableQty: 80,
      orders: [
        { userId: user1.id, qty: 40, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
        { userId: user2.id, qty: 40, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
      ],
    },
    "78": {
      availableQty: 60,
      orders: [
        { userId: user3.id, qty: 30, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
        { userId: user1.id, qty: 30, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
      ],
    },
  };

  const noOrderbook = {
    "42": {
      availableQty: 140,
      orders: [
        { userId: user2.id, qty: 70, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
        { userId: user3.id, qty: 70, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
      ],
    },
    "46": {
      availableQty: 120,
      orders: [
        { userId: user1.id, qty: 60, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
        { userId: user2.id, qty: 60, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
      ],
    },
    "50": {
      availableQty: 100,
      orders: [
        { userId: user3.id, qty: 50, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
        { userId: user1.id, qty: 50, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
      ],
    },
    "54": {
      availableQty: 80,
      orders: [
        { userId: user2.id, qty: 40, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
        { userId: user3.id, qty: 40, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
      ],
    },
    "58": {
      availableQty: 60,
      orders: [
        { userId: user1.id, qty: 30, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
        { userId: user2.id, qty: 30, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
      ],
    },
  };

  await prisma.market.update({
    where: { id: market.id },
    data: {
      yesOrderbook: JSON.stringify(yesOrderbook),
      noOrderbook: JSON.stringify(noOrderbook),
      totalQty: 930,
    },
  });

  // Add liquidity to second market
  const market2 = markets[1]!;
  const yesOrderbook2 = {
    "57": {
      availableQty: 120,
      orders: [
        { userId: user1.id, qty: 60, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
        { userId: user2.id, qty: 60, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
      ],
    },
    "61": {
      availableQty: 100,
      orders: [
        { userId: user3.id, qty: 50, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
        { userId: user1.id, qty: 50, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
      ],
    },
    "65": {
      availableQty: 80,
      orders: [
        { userId: user2.id, qty: 40, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
        { userId: user3.id, qty: 40, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
      ],
    },
  };

  const noOrderbook2 = {
    "47": {
      availableQty: 100,
      orders: [
        { userId: user2.id, qty: 50, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
        { userId: user3.id, qty: 50, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
      ],
    },
    "51": {
      availableQty: 80,
      orders: [
        { userId: user1.id, qty: 40, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
        { userId: user2.id, qty: 40, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
      ],
    },
    "55": {
      availableQty: 60,
      orders: [
        { userId: user3.id, qty: 30, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
        { userId: user1.id, qty: 30, filledQty: 0, originalOrderId: uuid(), reverseOrder: false },
      ],
    },
  };

  await prisma.market.update({
    where: { id: market2.id },
    data: {
      yesOrderbook: JSON.stringify(yesOrderbook2),
      noOrderbook: JSON.stringify(noOrderbook2),
      totalQty: 600,
    },
  });

  // Add positions for market 2
  await prisma.position.create({
    data: { userId: user1.id, marketId: market2.id, type: "Yes", qty: 40 },
  });

  await prisma.position.create({
    data: { userId: user3.id, marketId: market2.id, type: "No", qty: 35 },
  });

  // Add order history for market 2
  await prisma.orderHistory.create({
    data: {
      id: uuid(),
      orderType: "Buy",
      userId: user1.id,
      marketId: market2.id,
      price: 45,
      qty: 40,
    },
  });

  await prisma.orderHistory.create({
    data: {
      id: uuid(),
      orderType: "Buy",
      userId: user3.id,
      marketId: market2.id,
      price: 40,
      qty: 35,
    },
  });

  console.log("Seed completed successfully!");
  console.log(`Created ${markets.length} markets`);
  console.log(`Created ${users.length} users`);
  console.log(`Market 1 ID: ${market.id}`);
  console.log(`Market 2 ID: ${market2.id}`);
  console.log(`User 1 (alice): ${user1.id}`);
  console.log(`User 2 (bob): ${user2.id}`);
  console.log(`User 3 (charlie): ${user3.id}`);
  console.log(`\nLogin with any user email + password: "password123"`);
}

seed()
  .catch((e) => {
    console.error("Error seeding database:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
