-- AlterTable
ALTER TABLE "PaymentRequest" ADD COLUMN     "advanceVoucherNo" TEXT,
ADD COLUMN     "builtyNumber" TEXT,
ADD COLUMN     "invoiceNumber" TEXT,
ADD COLUMN     "remainingPercentage" DECIMAL(8,4);

-- AlterTable
ALTER TABLE "CounterpartyLedgerEntry" ADD COLUMN     "purchaseAdvanceFlow" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Voucher" ADD COLUMN     "advancePercentage" DECIMAL(8,4),
ADD COLUMN     "advanceTruckId" TEXT,
ADD COLUMN     "advanceWeightKg" DECIMAL(20,4),
ADD COLUMN     "builtyNumber" TEXT,
ADD COLUMN     "calculatedAdvancePkr" DECIMAL(20,2),
ADD COLUMN     "transporterName" TEXT;

-- CreateTable
CREATE TABLE "PurchaseAdvanceAllocation" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "amountPkr" DECIMAL(20,2) NOT NULL,
    "appliedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseAdvanceAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseAdvanceAllocation_voucherId_receiptId_key" ON "PurchaseAdvanceAllocation"("voucherId", "receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_advanceTruckId_key" ON "Voucher"("advanceTruckId");

-- AddForeignKey
ALTER TABLE "PurchaseAdvanceAllocation" ADD CONSTRAINT "PurchaseAdvanceAllocation_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseAdvanceAllocation" ADD CONSTRAINT "PurchaseAdvanceAllocation_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "InboundReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_advanceTruckId_fkey" FOREIGN KEY ("advanceTruckId") REFERENCES "PendingTruck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A rejected voucher may be corrected; active builty advances cannot be duplicated.
CREATE UNIQUE INDEX "Voucher_active_advance_builty" ON "Voucher" ("tradeRef", "builtyNumber") WHERE "builtyNumber" IS NOT NULL AND "status" <> 'REJECTED';
ALTER TABLE "PurchaseAdvanceAllocation" ADD CONSTRAINT "PurchaseAdvanceAllocation_positive" CHECK ("amountPkr" > 0);
ALTER TABLE "PurchaseAdvanceAllocation" ENABLE ROW LEVEL SECURITY;
