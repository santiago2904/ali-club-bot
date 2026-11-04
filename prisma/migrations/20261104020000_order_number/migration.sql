-- AlterTable
ALTER TABLE "Order" ADD COLUMN "number" SERIAL NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Order_number_key" ON "Order"("number");
