CREATE TABLE IF NOT EXISTS "PkePortMovement" (
 "id" TEXT PRIMARY KEY,
 "requestKey" TEXT NOT NULL UNIQUE,
 "importFileId" TEXT NOT NULL REFERENCES "PkeImportFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('WAREHOUSE','PORT_SALE')),
 "quantityMt" DECIMAL(20,6) NOT NULL CHECK ("quantityMt">0),
 "saleTradeRef" TEXT REFERENCES "Trade"("tradeRef") ON DELETE RESTRICT ON UPDATE CASCADE,
 "receiptId" TEXT UNIQUE REFERENCES "InboundReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "truckId" TEXT NOT NULL UNIQUE REFERENCES "PendingTruck"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "createdBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "PkePortMovement_importFileId_idx" ON "PkePortMovement"("importFileId");
CREATE INDEX IF NOT EXISTS "PkePortMovement_saleTradeRef_idx" ON "PkePortMovement"("saleTradeRef");
ALTER TABLE "PkePortMovement" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "PkePortMovement" FROM anon,authenticated;
-- Preserve earlier warehouse receipts; they must not become available to sell again.
INSERT INTO "PkePortMovement" ("id","requestKey","importFileId","kind","quantityMt","receiptId","truckId","createdBy","createdAt")
SELECT 'legacy-'||r."id",'receipt:'||r."receiptId",r."importFileId",'WAREHOUSE',r."quantityMt",r."receiptId",t."id",r."createdBy",r."createdAt"
FROM "PkeTripartyReceipt" r JOIN "InboundReceipt" i ON i."id"=r."receiptId" JOIN "PendingTruck" t ON t."gatepassNo"=i."gatepassNo"
ON CONFLICT DO NOTHING;
-- Reopen PKE books previously closed by delivery when their financial balance remains unpaid.
WITH eligible AS (
 SELECT t."tradeRef",t."direction",t."tradeParams",t."quantity"*1000*c."ratePerKg" AS due,
 CASE WHEN t."tradeParams"->>'internalCounterpartyEntity'='FZCO' THEN 'PAK' ELSE 'FZCO' END AS entity
 FROM "Trade" t JOIN "Commodity" m ON m."id"=t."commodityId" JOIN "ExecutionContract" c ON c."tradeRef"=t."tradeRef"
 WHERE m."code"='PKE' AND t."tradeStatus" IN ('LOCKED','CONFIRMED','EXECUTED')
 AND ((t."tradeParams"->>'tradingEntity' ILIKE '%FZCO%' AND COALESCE(t."tradeParams"->>'internalCounterpartyEntity','')='') OR (t."direction"='BUY' AND t."tradeParams"->>'internalCounterpartyEntity'='FZCO'))
), balances AS (
 SELECT e.*,COALESCE((SELECT SUM(v."amountPkr") FROM "Voucher" v WHERE v."tradeRef"=e."tradeRef" AND v."side"::text=e."direction"::text AND v."executionEntity"=e.entity AND v."status"='APPROVED'),0) AS paid FROM eligible e
), contracts AS (
 UPDATE "ExecutionContract" c SET "closeOnPayment"=true,"contractStatus"=CASE WHEN b.due>0 AND b.paid+0.005>=b.due THEN 'Close'::"ContractStatus" ELSE 'Open'::"ContractStatus" END
 FROM balances b WHERE c."tradeRef"=b."tradeRef" RETURNING c."tradeRef",c."contractStatus"
)
UPDATE "Trade" t SET "tradeStatus"=CASE WHEN c."contractStatus"='Close' THEN 'EXECUTED'::"TradeStatus" ELSE 'LOCKED'::"TradeStatus" END FROM contracts c WHERE t."tradeRef"=c."tradeRef";
