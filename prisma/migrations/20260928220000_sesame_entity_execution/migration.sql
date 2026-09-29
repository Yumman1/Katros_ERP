ALTER TABLE "ExecutionContract" ADD COLUMN IF NOT EXISTS "executionEntity" TEXT NOT NULL DEFAULT 'PAK', ADD COLUMN IF NOT EXISTS "paperOwnership" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PendingTruck" ADD COLUMN IF NOT EXISTS "executionEntity" TEXT NOT NULL DEFAULT 'PAK';
ALTER TABLE "Voucher" ADD COLUMN IF NOT EXISTS "executionEntity" TEXT NOT NULL DEFAULT 'PAK';
UPDATE "ExecutionContract" ec SET "executionEntity" = CASE WHEN t."tradeParams"->>'tradingEntity' = 'Kastros FZCO' OR (t."tradeParams"->>'tradingEntity' IS NULL AND t."tradeParams"->>'tradeRoute' = 'Dubai') THEN 'FZCO' ELSE 'PAK' END
FROM "Trade" t JOIN "Commodity" c ON c.id=t."commodityId" WHERE ec."tradeRef"=t."tradeRef" AND upper(c.code) IN ('SES','SESAME');
UPDATE "ExecutionContract" SET "paperOwnership" = true WHERE "executionEntity"='FZCO';
UPDATE "PendingTruck" p SET "executionEntity"=ec."executionEntity" FROM "ExecutionContract" ec WHERE ec."tradeRef"=coalesce(p."assignedTradeRef",p."gateInvoiceTradeRef");
UPDATE "Voucher" v SET "executionEntity"=CASE WHEN t."tradeParams"->>'tradingEntity'='Kastros FZCO' OR (t."tradeParams"->>'tradingEntity' IS NULL AND t."tradeParams"->>'tradeRoute'='Dubai') THEN 'FZCO' ELSE 'PAK' END FROM "Trade" t JOIN "Commodity" c ON c.id=t."commodityId" WHERE t."tradeRef"=v."tradeRef" AND upper(c.code) IN ('SES','SESAME');
CREATE TABLE IF NOT EXISTS "SesameOwnershipEntry" (
  "id" TEXT NOT NULL PRIMARY KEY, "tradeRef" TEXT NOT NULL, "commodityCode" TEXT NOT NULL,
  "fromEntity" TEXT, "toEntity" TEXT, "quantityMt" DECIMAL(18,6) NOT NULL CHECK ("quantityMt">0),
  "warehouseName" TEXT, "truckId" TEXT, "recordedBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SesameOwnershipEntry_tradeRef_fkey" FOREIGN KEY ("tradeRef") REFERENCES "Trade"("tradeRef") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SesameOwnershipEntry_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "PendingTruck"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SesameOwnershipEntry_entities_check" CHECK (("fromEntity" IS NULL OR "fromEntity" IN ('PAK','FZCO')) AND ("toEntity" IS NULL OR "toEntity" IN ('PAK','FZCO')) AND "fromEntity" IS DISTINCT FROM "toEntity")
);
CREATE INDEX IF NOT EXISTS "SesameOwnershipEntry_commodityCode_warehouseName_idx" ON "SesameOwnershipEntry"("commodityCode","warehouseName");
CREATE INDEX IF NOT EXISTS "SesameOwnershipEntry_tradeRef_idx" ON "SesameOwnershipEntry"("tradeRef");
CREATE INDEX IF NOT EXISTS "SesameOwnershipEntry_truckId_idx" ON "SesameOwnershipEntry"("truckId");
ALTER TABLE "SesameOwnershipEntry" ENABLE ROW LEVEL SECURITY;
