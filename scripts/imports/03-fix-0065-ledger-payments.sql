-- Kas-Cor26-0065 buy-ledger cleanup — idempotent, safe to re-run.
--
-- 1. Remove redundant BUY-side PAYMENT credits (pay-5 … pay-9). Inbound
--    payables settle on receipt PAID against the gatepass DEBIT, not via a
--    credit row. PaymentRequest rows remain the finance audit trail.
-- 2. Mark GP-IN-0416 / GP-IN-0417 fully paid (paid in real life but never
--    submitted through finance in the app).

BEGIN;

DELETE FROM "CounterpartyLedgerEntry"
WHERE side = 'BUY'
  AND "sourceType" = 'PAYMENT'
  AND "sourceRef" IN ('pay-5', 'pay-6', 'pay-7', 'pay-8', 'pay-9');

UPDATE "InboundReceipt"
SET "paidAmountPkr" = "amountDue",
    status = 'PAID'::"InboundReceiptStatus"
WHERE "gatepassNo" IN ('GP-IN-0416', 'GP-IN-0417')
  AND status IS DISTINCT FROM 'PAID'::"InboundReceiptStatus";

UPDATE "PendingTruck"
SET "gateInvoiceStage" = 'PAYMENT_APPROVED'::"GateInvoiceStage",
    "gateInvoiceHoldNote" = NULL
WHERE "gatepassNo" IN ('GP-IN-0416', 'GP-IN-0417');

UPDATE "CounterpartyLedgerEntry" cle
SET note = 'Inbound ' || cle."sourceRef" || ' · ' || pt."truckNo" || ' — paid'
FROM "PendingTruck" pt
WHERE cle.side = 'BUY'
  AND cle."sourceType" = 'GATEPASS'
  AND cle."sourceRef" IN ('GP-IN-0416', 'GP-IN-0417')
  AND pt."gatepassNo" = cle."sourceRef";

COMMIT;
