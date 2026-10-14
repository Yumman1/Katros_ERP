-- AlterTable
ALTER TABLE "PendingTruck" ADD COLUMN     "containerNo" TEXT,
ADD COLUMN     "croNo" TEXT,
ADD COLUMN     "exportShipmentId" TEXT;

-- AlterTable
ALTER TABLE "CounterpartyLedgerEntry" ADD COLUMN     "exportShipmentId" TEXT;

-- AlterTable
ALTER TABLE "Voucher" ADD COLUMN     "exportShipmentId" TEXT;

-- CreateTable
CREATE TABLE "SesameExportShipment" (
    "id" TEXT NOT NULL,
    "tradeRef" TEXT NOT NULL,
    "warehouseName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "deliveryOrderNo" TEXT,
    "gateOutSlipNo" TEXT,
    "blNo" TEXT,
    "totalWeightKg" DECIMAL(20,3) NOT NULL,
    "ratePkrPerKg" DECIMAL(20,8) NOT NULL,
    "quotedCurrency" TEXT NOT NULL,
    "fxRate" DECIMAL(20,8) NOT NULL,
    "defaultAmountPkr" DECIMAL(20,2) NOT NULL,
    "amountPkr" DECIMAL(20,2) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "traderApprovedBy" TEXT,
    "executionApprovedBy" TEXT,
    "financeApprovedBy" TEXT,
    "releasedAt" TIMESTAMP(3),
    "blRecordedAt" TIMESTAMP(3),
    "audit" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SesameExportShipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SesameExportSubmission" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SesameExportSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SesameExportShipment_deliveryOrderNo_key" ON "SesameExportShipment"("deliveryOrderNo");

-- CreateIndex
CREATE UNIQUE INDEX "SesameExportShipment_gateOutSlipNo_key" ON "SesameExportShipment"("gateOutSlipNo");

-- CreateIndex
CREATE UNIQUE INDEX "SesameExportShipment_blNo_key" ON "SesameExportShipment"("blNo");

-- CreateIndex
CREATE INDEX "SesameExportShipment_tradeRef_status_idx" ON "SesameExportShipment"("tradeRef", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CounterpartyLedgerEntry_exportShipmentId_key" ON "CounterpartyLedgerEntry"("exportShipmentId");

-- AddForeignKey
ALTER TABLE "PendingTruck" ADD CONSTRAINT "PendingTruck_exportShipmentId_fkey" FOREIGN KEY ("exportShipmentId") REFERENCES "SesameExportShipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounterpartyLedgerEntry" ADD CONSTRAINT "CounterpartyLedgerEntry_exportShipmentId_fkey" FOREIGN KEY ("exportShipmentId") REFERENCES "SesameExportShipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_exportShipmentId_fkey" FOREIGN KEY ("exportShipmentId") REFERENCES "SesameExportShipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SesameExportShipment" ADD CONSTRAINT "SesameExportShipment_tradeRef_fkey" FOREIGN KEY ("tradeRef") REFERENCES "Trade"("tradeRef") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SesameExportSubmission" ADD CONSTRAINT "SesameExportSubmission_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "SesameExportShipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "SesameExportShipment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SesameExportSubmission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SesameExportShipment" ADD CONSTRAINT "export_status_check" CHECK (status IN ('DRAFT','REJECTED','TRADER_PENDING','EXECUTION_PENDING','FINANCE_PENDING','APPROVED','RELEASED','BL_RECORDED'));
ALTER TABLE "SesameExportShipment" ADD CONSTRAINT "export_amounts_check" CHECK ("totalWeightKg">=0 AND "ratePkrPerKg">0 AND "fxRate">0 AND "amountPkr">=0);
CREATE UNIQUE INDEX "export_open_group" ON "SesameExportShipment"("tradeRef","warehouseName") WHERE status='DRAFT';
CREATE INDEX "PendingTruck_exportShipmentId_idx" ON "PendingTruck"("exportShipmentId");
CREATE INDEX "Voucher_exportShipmentId_idx" ON "Voucher"("exportShipmentId");
