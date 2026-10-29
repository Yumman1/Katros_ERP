CREATE TABLE IF NOT EXISTS "PkeTripartyReceipt" (
 "id" TEXT PRIMARY KEY,
 "importFileId" TEXT NOT NULL REFERENCES "PkeImportFile"("id") ON DELETE RESTRICT,
 "receiptId" TEXT NOT NULL UNIQUE REFERENCES "InboundReceipt"("id") ON DELETE RESTRICT,
 "purchaseTradeRef" TEXT NOT NULL REFERENCES "Trade"("tradeRef") ON DELETE RESTRICT,
 "saleTradeRef" TEXT NOT NULL REFERENCES "Trade"("tradeRef") ON DELETE RESTRICT,
 "quantityMt" DECIMAL(20,6) NOT NULL CHECK ("quantityMt" > 0),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "createdBy" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "PkeTripartyReceipt_purchaseTradeRef_idx" ON "PkeTripartyReceipt"("purchaseTradeRef");
CREATE INDEX IF NOT EXISTS "PkeTripartyReceipt_saleTradeRef_idx" ON "PkeTripartyReceipt"("saleTradeRef");
ALTER TABLE "PkeTripartyReceipt" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "PkeTripartyReceipt" FROM anon, authenticated;
-- PKE import quantities close on receipt, independently of outstanding payments.
UPDATE "ExecutionContract" c SET "closeOnPayment" = false
FROM "Trade" t JOIN "Commodity" m ON m.id=t."commodityId"
WHERE c."tradeRef"=t."tradeRef" AND m.code='PKE'
AND ((t."tradeParams"->>'tradingEntity'='Kastros FZCO' AND COALESCE(t."tradeParams"->>'internalCounterpartyEntity','')='')
OR (t.direction='BUY' AND t."tradeParams"->>'tradingEntity'='Kastros PAK' AND t."tradeParams"->>'internalCounterpartyEntity'='FZCO'));
