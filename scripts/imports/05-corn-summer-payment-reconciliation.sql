-- Corn Summer Purchase import — payment / gate-invoice reconciliation (17 Aug 2026).
--
-- Aligns misclassified bulk-import rows with the Purchase workbook without
-- changing live trader/finance approval flows. Historical "Payment Release"
-- rows are marked PAID directly (no finance queue); partial holds on inv 18/21
-- are left untouched.
--
-- Idempotent — safe to re-run.

BEGIN;

-- ─── A. Payment Release rows stuck in PENDING_TRADE_APPROVAL ───────────────

UPDATE "InboundReceipt" ir
SET "paidAmountPkr" = ir."amountDue",
    status = 'PAID'::"InboundReceiptStatus",
    "paymentRequestId" = NULL,
    "updatedAt" = NOW()
WHERE ir."kcsNo" IN ('KCS-417', 'KCS-419', 'KCS-420')
  AND ir.status IS DISTINCT FROM 'PAID'::"InboundReceiptStatus";

UPDATE "PendingTruck" pt
SET "gateInvoiceStage" = 'PAYMENT_APPROVED'::"GateInvoiceStage",
    "gateInvoiceHoldNote" = NULL,
    "updatedAt" = NOW()
FROM "InboundReceipt" ir
WHERE ir."gatepassNo" = pt."gatepassNo"
  AND ir."kcsNo" IN ('KCS-417', 'KCS-419', 'KCS-420');

-- ─── B. Payment Release rows stuck in FINANCE_PENDING (KCS-418, KCS-323) ─

UPDATE "InboundReceipt" ir
SET "paidAmountPkr" = ir."amountDue",
    status = 'PAID'::"InboundReceiptStatus",
    "paymentRequestId" = NULL,
    "updatedAt" = NOW()
WHERE ir."kcsNo" IN ('KCS-418', 'KCS-323')
  AND ir.status IS DISTINCT FROM 'PAID'::"InboundReceiptStatus";

UPDATE "PendingTruck" pt
SET "gateInvoiceStage" = 'PAYMENT_APPROVED'::"GateInvoiceStage",
    "gateInvoiceHoldNote" = NULL,
    "updatedAt" = NOW()
FROM "InboundReceipt" ir
WHERE ir."gatepassNo" = pt."gatepassNo"
  AND ir."kcsNo" IN ('KCS-418', 'KCS-323');

-- Close ghost finance queue items for historical imports (audit via PR row status).
UPDATE "PaymentRequest"
SET status = 'APPROVED'::"PaymentRequestStatus",
    "approvedBy" = COALESCE("approvedBy", 'corn-excel-payment-sync'),
    "approvedAt" = COALESCE("approvedAt", NOW()),
    "updatedAt" = NOW()
WHERE "requestRef" IN ('pay-3', 'pay-10')
  AND status = 'PENDING'::"PaymentRequestStatus";

-- ─── C. Buy-ledger notes for newly cleared gatepasses ─────────────────────

UPDATE "CounterpartyLedgerEntry" cle
SET note = 'Inbound ' || cle."sourceRef" || ' · ' || pt."truckNo" || ' — paid'
FROM "PendingTruck" pt
JOIN "InboundReceipt" ir ON ir."gatepassNo" = pt."gatepassNo"
WHERE cle.side = 'BUY'
  AND cle."sourceType" = 'GATEPASS'
  AND cle."sourceRef" = pt."gatepassNo"
  AND ir."kcsNo" IN ('KCS-417', 'KCS-419', 'KCS-420', 'KCS-418', 'KCS-323')
  AND ir.status = 'PAID'::"InboundReceiptStatus";

COMMIT;

-- ─── Verification (expect 0 / 4 / 0) ──────────────────────────────────────
-- SELECT COUNT(*) AS pending_trade_approval FROM "PendingTruck" WHERE "gateInvoiceStage" = 'PENDING_TRADE_APPROVAL';
-- SELECT COUNT(*) AS partial_payment FROM "PendingTruck" WHERE "gateInvoiceStage" = 'PARTIAL_PAYMENT';
-- SELECT COUNT(*) AS finance_pending FROM "InboundReceipt" WHERE status = 'FINANCE_PENDING';
