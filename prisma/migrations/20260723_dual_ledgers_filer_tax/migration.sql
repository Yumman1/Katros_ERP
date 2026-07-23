-- Single counterparty identity with two separate ledger accounts (BUY
-- payables / SELL receivables), filer vs non-filer 236G rates, the SETTLED
-- sale stage with settle-against-old-dues, and rejection records.

-- New sale stage + payment source (safe to add; not used inside this migration).
ALTER TYPE "SaleTruckStage" ADD VALUE IF NOT EXISTS 'SETTLED';
ALTER TYPE "LedgerSourceType" ADD VALUE IF NOT EXISTS 'PAYMENT';

-- 236G filer status per counterparty + non-filer policy rate.
CREATE TYPE "TaxFilerStatus" AS ENUM ('FILER', 'NON_FILER');
ALTER TABLE "Counterparty"
  ADD COLUMN "taxFilerStatus" "TaxFilerStatus" NOT NULL DEFAULT 'FILER';
ALTER TABLE "FinancePolicy"
  ADD COLUMN "advanceTaxRatePctNonFiler" DECIMAL(8,4) NOT NULL DEFAULT 2.0;

-- Ledger entries carry the account side.
ALTER TABLE "CounterpartyLedgerEntry"
  ADD COLUMN "side" "CounterpartySide" NOT NULL DEFAULT 'SELL';
CREATE INDEX "CounterpartyLedgerEntry_counterpartyId_side_entryDate_idx"
  ON "CounterpartyLedgerEntry"("counterpartyId", "side", "entryDate");

-- Settlement stamp on trucks.
ALTER TABLE "PendingTruck"
  ADD COLUMN "saleSettledAt" TIMESTAMP(3),
  ADD COLUMN "saleSettledBy" TEXT;

-- Rejection records.
CREATE TABLE "RejectionRecord" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "refLabel" TEXT NOT NULL,
  "gatepassNo" TEXT,
  "voucherNo" TEXT,
  "tradeRef" TEXT,
  "counterpartyName" TEXT,
  "amountPkr" DECIMAL(20,2),
  "traderName" TEXT,
  "rejectedBy" TEXT NOT NULL,
  "rejectedRole" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RejectionRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RejectionRecord_createdAt_idx" ON "RejectionRecord"("createdAt");
CREATE INDEX "RejectionRecord_traderName_idx" ON "RejectionRecord"("traderName");
ALTER TABLE "RejectionRecord" ENABLE ROW LEVEL SECURITY;

-- ── Merge split CPS- counterparty records back into the single CP identity ──
-- The register split is reverted: one counterparty record per party; the
-- BUY/SELL separation now lives at ledger-account level. Any SELL-side
-- duplicate whose trading name matches a BUY-side record has its references
-- repointed to the original, then the duplicate is removed.
UPDATE "Trade" t
SET "counterpartyId" = orig."id"
FROM "Counterparty" dup
JOIN "Counterparty" orig
  ON lower(orig."name") = lower(dup."name") AND orig."side" = 'BUY' AND orig."id" <> dup."id"
WHERE dup."side" = 'SELL' AND t."counterpartyId" = dup."id";

UPDATE "Invoice" i
SET "counterpartyId" = orig."id"
FROM "Counterparty" dup
JOIN "Counterparty" orig
  ON lower(orig."name") = lower(dup."name") AND orig."side" = 'BUY' AND orig."id" <> dup."id"
WHERE dup."side" = 'SELL' AND i."counterpartyId" = dup."id";

UPDATE "Voucher" v
SET "counterpartyId" = orig."id"
FROM "Counterparty" dup
JOIN "Counterparty" orig
  ON lower(orig."name") = lower(dup."name") AND orig."side" = 'BUY' AND orig."id" <> dup."id"
WHERE dup."side" = 'SELL' AND v."counterpartyId" = dup."id";

UPDATE "CounterpartyLedgerEntry" e
SET "counterpartyId" = orig."id"
FROM "Counterparty" dup
JOIN "Counterparty" orig
  ON lower(orig."name") = lower(dup."name") AND orig."side" = 'BUY' AND orig."id" <> dup."id"
WHERE dup."side" = 'SELL' AND e."counterpartyId" = dup."id";

DELETE FROM "Counterparty" dup
USING "Counterparty" orig
WHERE dup."side" = 'SELL'
  AND orig."side" = 'BUY'
  AND orig."id" <> dup."id"
  AND lower(orig."name") = lower(dup."name");
