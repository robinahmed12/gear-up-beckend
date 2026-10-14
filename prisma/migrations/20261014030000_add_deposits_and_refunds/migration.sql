-- Additive migration: security-deposit holds + refunds.
--
-- Adds a new terminal payment state (PARTIALLY_REFUNDED), the deposit and
-- refund lifecycle enums, and the two new tables. Nothing existing is
-- altered destructively; no backfill is needed because both tables start
-- empty.

-- AlterEnum: a captured payment can be refunded in part.
ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIALLY_REFUNDED';

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'RELEASED', 'CAPTURED', 'FAILED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateTable: security deposit hold (one per order)
CREATE TABLE "deposits" (
    "id" TEXT NOT NULL,
    "rentalOrderId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
    "stripePaymentIntentId" TEXT,
    "authorizedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3),
    "capturedAmount" DECIMAL(10,2),
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deposits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deposits_rentalOrderId_key" ON "deposits"("rentalOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "deposits_stripePaymentIntentId_key" ON "deposits"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "deposits_status_idx" ON "deposits"("status");

-- CreateTable: refunds against a captured payment
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "reason" TEXT,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "stripeRefundId" TEXT,
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refunds_stripeRefundId_key" ON "refunds"("stripeRefundId");

-- CreateIndex
CREATE INDEX "refunds_paymentId_idx" ON "refunds"("paymentId");

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_rentalOrderId_fkey" FOREIGN KEY ("rentalOrderId") REFERENCES "rental_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
