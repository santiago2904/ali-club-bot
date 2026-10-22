-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "deliveryAddress" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "deliveryFeeCop" INTEGER NOT NULL,
    "subtotalCop" INTEGER NOT NULL,
    "totalCop" INTEGER NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "proofImagePath" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

