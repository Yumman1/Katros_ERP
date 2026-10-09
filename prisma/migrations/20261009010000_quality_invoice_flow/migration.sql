-- Physical receipts and payable invoice weights are independent.
ALTER TABLE "PendingTruck" ADD COLUMN "purchaseTradeRef" TEXT;
ALTER TABLE "PaymentRequest" ADD COLUMN "paymentReference" TEXT;
ALTER TABLE "Voucher" ADD COLUMN "agreedAdvancePercentage" DECIMAL(8,4),
 ADD COLUMN "agreedTradeAmountPkr" DECIMAL(20,2),
 ADD COLUMN "traderApprovalRequired" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "traderApprovedAt" TIMESTAMP(3),
 ADD COLUMN "traderApprovedBy" TEXT;

-- Existing paid vouchers remain approved. Snapshot the known agreed terms.
UPDATE "Voucher" v SET "agreedAdvancePercentage" = CASE
 WHEN t."paymentType"='ADVANCE_100' THEN COALESCE(NULLIF(t."tradeParams"->>'paymentPercentage','')::numeric,100)
 WHEN t."paymentType"='AFTER_DELIVERY_100' THEN 100-COALESCE(NULLIF(t."tradeParams"->>'paymentPercentage','')::numeric,100)
 ELSE 0 END,
 "agreedTradeAmountPkr" = c."contractualQtyMt" * CASE UPPER(c."quantityUnit") WHEN 'MT' THEN 1000 WHEN 'KG' THEN 1 WHEN 'MAUND' THEN 40 WHEN 'MAUND_37' THEN 37.324 WHEN 'MAUND_40' THEN 40 ELSE 1000 END * COALESCE(c."ratePerKg",c."ratePerMaund"/40)
FROM "Trade" t JOIN "ExecutionContract" c ON c."tradeRef"=t."tradeRef"
WHERE v."tradeRef"=t."tradeRef" AND v.side='BUY';
UPDATE "Voucher" SET "traderApprovalRequired"=true
WHERE status='PENDING_FINANCE' AND "advancePercentage">"agreedAdvancePercentage";

-- Restore only one-truck receipts whose allocation matches the former net-weight
-- calculation. Do not change invoiced amounts, payments, deductions or ledger rows.
WITH quality_invoice_stock_corrections AS (
SELECT q.*, q.qty-q.old_qty AS delta FROM (
 SELECT r.id, r."tradeRef",r."warehouseName",r."allocatedQtyMt" AS old_qty, COALESCE(NULLIF(t."warehouseWeightKg",0),t."weightAsPerBuiltyKg") / CASE UPPER(c."quantityUnit") WHEN 'MT' THEN 1000 WHEN 'KG' THEN 1 WHEN 'MAUND' THEN 40 WHEN 'MAUND_37' THEN 37.324 WHEN 'MAUND_40' THEN 40 ELSE 1000 END AS qty
 FROM "InboundReceipt" r JOIN "PendingTruck" t ON t."gatepassNo"=r."gatepassNo"
 JOIN "ExecutionContract" c ON c."tradeRef"=r."tradeRef"
 WHERE t."movementType"='INBOUND' AND t.status='ASSIGNED'
 AND (SELECT COUNT(*) FROM "InboundReceipt" r2 WHERE r2."gatepassNo"=r."gatepassNo")=1
 AND UPPER(c."quantityUnit") IN ('MT','KG','MAUND','MAUND_40','MAUND_37')
 AND ABS(r."allocatedQtyMt"-(CASE WHEN c."executionProfile"='PURCHASE_SPOT' THEN t."weightAsPerBuiltyKg" ELSE t."warehouseWeightKg"-COALESCE(t."totalDeductionsKg",0) END)/CASE UPPER(c."quantityUnit") WHEN 'MT' THEN 1000 WHEN 'KG' THEN 1 WHEN 'MAUND' THEN 40 WHEN 'MAUND_37' THEN 37.324 WHEN 'MAUND_40' THEN 40 ELSE 1000 END)<0.00001
) q WHERE q.qty>0 AND ABS(q.qty-q.old_qty)>0.000001
), corrected_receipts AS (
UPDATE "InboundReceipt" r SET "allocatedQtyMt"=c.qty FROM quality_invoice_stock_corrections c WHERE r.id=c.id RETURNING r.id
), corrected_contracts AS (
UPDATE "ExecutionContract" c SET "receivedQtyMt"=c."receivedQtyMt"+d.delta, "openQtyMt"=GREATEST(0,c."contractualQtyMt"-c."receivedQtyMt"-d.delta) FROM (SELECT "tradeRef",SUM(delta) AS delta FROM quality_invoice_stock_corrections GROUP BY "tradeRef") d WHERE c."tradeRef"=d."tradeRef" RETURNING c.id
)
UPDATE "ContractWarehouseAllocation" a SET "fulfilledQtyMt"=a."fulfilledQtyMt"+d.delta FROM (SELECT c.id AS contract_id,q."warehouseName",SUM(q.delta) AS delta FROM quality_invoice_stock_corrections q JOIN "ExecutionContract" c ON c."tradeRef"=q."tradeRef" GROUP BY c.id,q."warehouseName") d WHERE a."contractId"=d.contract_id AND lower(trim(a."warehouseName"))=lower(trim(d."warehouseName"));
UPDATE "PendingTruck" SET "weightKg"=COALESCE(NULLIF("warehouseWeightKg",0),"weightAsPerBuiltyKg")
WHERE "movementType"='INBOUND' AND status='ASSIGNED' AND COALESCE(NULLIF("warehouseWeightKg",0),"weightAsPerBuiltyKg")>0;
-- Auto-close status is refreshed by the application on locked-contract reads.
