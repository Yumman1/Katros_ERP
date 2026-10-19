-- External supplier -> Dubai FZCO -> buyer. Supplier purchase remains independent financially.
ALTER TABLE "SesameExportShipment" ADD COLUMN "sourcePurchaseTradeRef" TEXT,
 ADD COLUMN "supplierAmountPkr" DECIMAL(20,2), ADD COLUMN "supplierFxRate" DECIMAL(20,8);
ALTER TABLE "SesameExportShipment" ADD CONSTRAINT "SesameExportShipment_sourcePurchaseTradeRef_fkey"
 FOREIGN KEY ("sourcePurchaseTradeRef") REFERENCES "Trade"("tradeRef") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "SesameExportShipment_sourcePurchaseTradeRef_idx" ON "SesameExportShipment"("sourcePurchaseTradeRef");
ALTER TABLE "SesameExportShipment" ADD CONSTRAINT "external_triparty_source_check"
 CHECK ("sourcePurchaseTradeRef" IS NULL OR ("directThirdParty" AND NOT "triparty"));
DROP INDEX IF EXISTS "export_open_group";
CREATE UNIQUE INDEX "export_open_group" ON "SesameExportShipment"
 ("tradeRef", "warehouseName", COALESCE("sourcePurchaseTradeRef", ''), COALESCE("fzcoSaleTradeRef", '')) WHERE status='DRAFT';
-- Keep stock quantities unchanged. Reopen only external FZCO contracts that were
-- closed by physical fulfilment while their supplier/buyer balance is unpaid.
UPDATE "ExecutionContract" c SET "closeOnPayment"=true FROM "Trade" t, "Commodity" m
 WHERE c."tradeRef"=t."tradeRef" AND t."commodityId"=m.id
 AND m.code IN ('SES','SESAME') AND t."tradeParams"->>'tradingEntity'='Kastros FZCO'
 AND COALESCE(t."tradeParams"->>'internalCounterpartyEntity','') NOT IN ('PAK','FZCO');
WITH unpaid AS (
 SELECT c.id,c."tradeRef" FROM "ExecutionContract" c JOIN "Trade" t ON t."tradeRef"=c."tradeRef"
 WHERE c."closeOnPayment" AND t."tradeParams"->>'tradingEntity'='Kastros FZCO'
 AND COALESCE(t."tradeParams"->>'internalCounterpartyEntity','') NOT IN ('PAK','FZCO')
 AND t."tradeStatus" IN ('LOCKED','CONFIRMED','EXECUTED') AND c."contractStatus"='Close'
 AND COALESCE((SELECT SUM(l."amountPkr") FROM "CounterpartyLedgerEntry" l WHERE l."tradeRef"=t."tradeRef" AND l.side::text=t.direction::text AND l."entryType"='CREDIT'),0)+0.005
 < GREATEST(c."contractualQtyMt"*1000*c."ratePerKg",COALESCE((SELECT SUM(l."amountPkr") FROM "CounterpartyLedgerEntry" l WHERE l."tradeRef"=t."tradeRef" AND l.side::text=t.direction::text AND l."entryType"='DEBIT' AND l."sourceType" IN ('INVOICE','ADJUSTMENT')),0))
), reopened AS (
 UPDATE "ExecutionContract" c SET "contractStatus"='Open' FROM unpaid u WHERE c.id=u.id RETURNING c."tradeRef"
)
UPDATE "Trade" t SET "tradeStatus"='LOCKED' FROM reopened r WHERE t."tradeRef"=r."tradeRef";
