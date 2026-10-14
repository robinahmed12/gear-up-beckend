-- Additive migration: order pricing breakdown + itemized line items + currency.
-- Every new column has a default so existing rows migrate without a manual
-- backfill; existing orders set subtotal from their historical totalAmount.

-- AlterTable: RentalOrder breakdown snapshot columns
ALTER TABLE "rental_orders" ADD COLUMN "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "rental_orders" ADD COLUMN "serviceFee" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "rental_orders" ADD COLUMN "depositAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "rental_orders" ADD COLUMN "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "rental_orders" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';

-- Backfill: for orders created before this migration, totalAmount was the
-- rental cost with no fees/deposit/tax, so subtotal === totalAmount.
UPDATE "rental_orders" SET "subtotal" = "totalAmount" WHERE "subtotal" = 0;

-- AlterTable: Payment currency snapshot
ALTER TABLE "payments" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';

-- CreateEnum
CREATE TYPE "OrderLineItemType" AS ENUM ('RENTAL', 'SERVICE_FEE', 'DEPOSIT', 'TAX', 'DAMAGE_FEE', 'LATE_FEE', 'REFUND', 'ADJUSTMENT');

-- CreateTable: OrderLineItem
CREATE TABLE "order_line_items" (
    "id" TEXT NOT NULL,
    "rentalOrderId" TEXT NOT NULL,
    "type" "OrderLineItemType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_line_items_rentalOrderId_idx" ON "order_line_items"("rentalOrderId");

-- AddForeignKey
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_rentalOrderId_fkey" FOREIGN KEY ("rentalOrderId") REFERENCES "rental_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
