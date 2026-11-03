-- All approved PKE books close on approved payment, including local port sales.
-- Preserve quantities and movements; reopen delivery-closed unpaid contracts.
WITH eligible AS (
 SELECT t."tradeRef",t.direction,
 GREATEST(t.quantity*1000*c."ratePerKg",COALESCE((SELECT SUM(l."amountPkr") FROM "CounterpartyLedgerEntry" l WHERE l."tradeRef"=t."tradeRef" AND l.side::text=t.direction::text AND l."entryType"='DEBIT'),0)) AS due,
 (t.direction='BUY' AND t."tradeParams"->>'internalCounterpartyEntity'='FZCO') AS internal
 FROM "Trade" t JOIN "Commodity" m ON m.id=t."commodityId" JOIN "ExecutionContract" c ON c."tradeRef"=t."tradeRef"
 WHERE m.code='PKE' AND t."tradeStatus" IN ('LOCKED','CONFIRMED','EXECUTED')
), balances AS (
 SELECT e.*,COALESCE((SELECT SUM(g.amount) FROM (
 SELECT MAX(v."amountPkr") amount FROM "Voucher" v
 WHERE v."tradeRef"=e."tradeRef" AND v.status='APPROVED' AND v."noteRef" IS NULL
 AND ((e.internal AND (v."internalPaymentRef" IS NOT NULL OR (v."voucherKind"='INTL_PURCHASE' AND v."executionEntity"='FZCO' AND v.side='BUY')))
 OR (NOT e.internal AND v.side::text=e.direction::text))
 GROUP BY COALESCE(v."internalPaymentRef",v.id)
 ) g),0) paid FROM eligible e
), contracts AS (
 UPDATE "ExecutionContract" c SET "closeOnPayment"=true,"contractStatus"=CASE WHEN b.due>0 AND b.paid+0.005>=b.due THEN 'Close'::"ContractStatus" ELSE 'Open'::"ContractStatus" END
 FROM balances b WHERE c."tradeRef"=b."tradeRef" RETURNING c."tradeRef",c."contractStatus"
)
UPDATE "Trade" t SET "tradeStatus"=CASE WHEN c."contractStatus"='Close' THEN 'EXECUTED'::"TradeStatus" ELSE 'LOCKED'::"TradeStatus" END FROM contracts c WHERE t."tradeRef"=c."tradeRef";
