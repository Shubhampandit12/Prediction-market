-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "usdBalance" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "Market" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "resolutionDescription" TEXT NOT NULL,
    "yesOrderbook" TEXT NOT NULL DEFAULT '{}',
    "noOrderbook" TEXT NOT NULL DEFAULT '{}',
    "totalQty" INTEGER NOT NULL DEFAULT 0,
    "resolution" TEXT,
    "createdBy" TEXT
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    CONSTRAINT "Position_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Position_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderType" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderHistory_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Position_userId_marketId_type_key" ON "Position"("userId", "marketId", "type");
