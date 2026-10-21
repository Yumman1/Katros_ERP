-- FZCO is a payment-closed book. It does not confirm paper / off-site ownership.
-- Idempotent: safe to re-run.

DELETE FROM "SesameOwnershipEntry"
WHERE "warehouseName" IS NULL OR btrim("warehouseName") = '';

UPDATE "ExecutionContract"
SET "closeOnPayment" = true
WHERE "executionEntity" = 'FZCO'
  AND "contractStatus" = 'Open'
  AND "closeOnPayment" = false;
