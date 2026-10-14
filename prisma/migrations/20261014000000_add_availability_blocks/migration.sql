-- CreateTable
CREATE TABLE "gear_availability_blocks" (
    "id" TEXT NOT NULL,
    "gearId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gear_availability_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gear_availability_blocks_gearId_startDate_endDate_idx" ON "gear_availability_blocks"("gearId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "rental_orders_gearId_status_startDate_endDate_idx" ON "rental_orders"("gearId", "status", "startDate", "endDate");

-- AddForeignKey
ALTER TABLE "gear_availability_blocks" ADD CONSTRAINT "gear_availability_blocks_gearId_fkey" FOREIGN KEY ("gearId") REFERENCES "gear_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
