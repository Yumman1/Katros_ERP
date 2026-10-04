ALTER TABLE "StockTransfer" ADD COLUMN "internalGateToken" TEXT NOT NULL DEFAULT gen_random_uuid()::text;
CREATE UNIQUE INDEX "StockTransfer_internalGateToken_key" ON "StockTransfer"("internalGateToken");
ALTER TABLE "StockTransfer" ADD COLUMN "sesameType" TEXT NOT NULL DEFAULT 'Machine Cleaned', ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'SHIFT';
CREATE TABLE "SesameProcessing" (
 "id" TEXT NOT NULL PRIMARY KEY, "requestKey" TEXT NOT NULL UNIQUE,
 "transferId" TEXT NOT NULL REFERENCES "StockTransfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "commodityCode" TEXT NOT NULL, "warehouseName" TEXT NOT NULL,
 "fromType" TEXT NOT NULL, "toType" TEXT NOT NULL,
 "inputKg" DECIMAL(20,3) NOT NULL CHECK ("inputKg" > 0),
 "yieldRatio" DECIMAL(8,6) NOT NULL CHECK ("yieldRatio" >= 0 AND "yieldRatio" <= 1),
 "outputKg" DECIMAL(20,3) NOT NULL, "impuritiesKg" DECIMAL(20,3) NOT NULL,
 "recordedBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ("outputKg" >= 0 AND "impuritiesKg" >= 0 AND "inputKg" = "outputKg" + "impuritiesKg"),
 CHECK (("fromType" = 'Raw' AND "toType" IN ('Machine Cleaned','Sortex')) OR ("fromType" = 'Machine Cleaned' AND "toType" = 'Sortex'))
);
CREATE INDEX "SesameProcessing_commodityCode_warehouseName_idx" ON "SesameProcessing"("commodityCode", "warehouseName");

ALTER TABLE "StockTransfer" ADD COLUMN "dispatchedBy" TEXT, ADD COLUMN "receivedBy" TEXT;
ALTER TABLE "SesameProcessing" ENABLE ROW LEVEL SECURITY;

-- Internal gate tokens must only be distributed by the server-side execution UI.
ALTER TABLE "StockTransfer" ENABLE ROW LEVEL SECURITY;
