-- Sale-side build: buyer/seller counterparty split, finance policies (yearly
-- inflow limit + 236G advance tax), counterparty ledgers, payment vouchers,
-- outbound sale truck workflow, and trade-booking drafts.

-- ── Counterparty: side split + booking contact ──────────────────────────────
CREATE TYPE "CounterpartySide" AS ENUM ('BUY', 'SELL');

ALTER TABLE "Counterparty"
  ADD COLUMN "side" "CounterpartySide" NOT NULL DEFAULT 'BUY',
  ADD COLUMN "contactPerson" TEXT,
  ADD COLUMN "contactPhone" TEXT;

CREATE INDEX "Counterparty_side_idx" ON "Counterparty"("side");

-- ── Outbound sale truck workflow ─────────────────────────────────────────────
CREATE TYPE "SaleTruckStage" AS ENUM (
  'AWAITING_BALANCE',
  'PENDING_TRADER',
  'PENDING_FINANCE',
  'PAYMENT_RECEIVED',
  'CLEAR_PENDING_TRADER',
  'CLEAR_PENDING_CEO',
  'CLEARED_UNPAID'
);

ALTER TABLE "PendingTruck"
  ADD COLUMN "saleBasePkr" DECIMAL(20,2),
  ADD COLUMN "saleTaxPkr" DECIMAL(20,2),
  ADD COLUMN "saleExpectedPkr" DECIMAL(20,2),
  ADD COLUMN "saleStage" "SaleTruckStage",
  ADD COLUMN "saleTraderApprovedBy" TEXT,
  ADD COLUMN "saleTraderApprovedAt" TIMESTAMP(3),
  ADD COLUMN "saleFinanceApprovedBy" TEXT,
  ADD COLUMN "saleFinanceApprovedAt" TIMESTAMP(3),
  ADD COLUMN "saleCeoApprovedBy" TEXT,
  ADD COLUMN "saleCeoApprovedAt" TIMESTAMP(3),
  ADD COLUMN "gateOutSlipNo" TEXT,
  ADD COLUMN "deliveryOrderNo" TEXT;

CREATE UNIQUE INDEX "PendingTruck_gateOutSlipNo_key" ON "PendingTruck"("gateOutSlipNo");
CREATE UNIQUE INDEX "PendingTruck_deliveryOrderNo_key" ON "PendingTruck"("deliveryOrderNo");

-- ── Finance policy singleton ─────────────────────────────────────────────────
CREATE TABLE "FinancePolicy" (
  "id" TEXT NOT NULL DEFAULT 'main',
  "yearlyInflowLimitPkr" DECIMAL(20,2) NOT NULL DEFAULT 200000000,
  "advanceTaxRatePct" DECIMAL(8,4) NOT NULL DEFAULT 0.1,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" TEXT,

  CONSTRAINT "FinancePolicy_pkey" PRIMARY KEY ("id")
);

INSERT INTO "FinancePolicy" ("id") VALUES ('main') ON CONFLICT DO NOTHING;

-- ── Vouchers + counterparty ledgers ──────────────────────────────────────────
CREATE TYPE "LedgerEntryType" AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE "LedgerSourceType" AS ENUM ('GATEPASS', 'VOUCHER', 'ADJUSTMENT');
CREATE TYPE "VoucherStatus" AS ENUM ('PENDING_FINANCE', 'APPROVED', 'REJECTED');

CREATE TABLE "Voucher" (
  "id" TEXT NOT NULL,
  "voucherNo" TEXT NOT NULL,
  "counterpartyId" TEXT NOT NULL,
  "amountPkr" DECIMAL(20,2) NOT NULL,
  "method" TEXT,
  "reference" TEXT,
  "note" TEXT,
  "status" "VoucherStatus" NOT NULL DEFAULT 'PENDING_FINANCE',
  "enteredByName" TEXT NOT NULL,
  "resolvedByName" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolutionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Voucher_voucherNo_key" ON "Voucher"("voucherNo");
CREATE INDEX "Voucher_status_idx" ON "Voucher"("status");
CREATE INDEX "Voucher_counterpartyId_idx" ON "Voucher"("counterpartyId");

ALTER TABLE "Voucher"
  ADD CONSTRAINT "Voucher_counterpartyId_fkey"
  FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CounterpartyLedgerEntry" (
  "id" TEXT NOT NULL,
  "counterpartyId" TEXT NOT NULL,
  "entryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "entryType" "LedgerEntryType" NOT NULL,
  "amountPkr" DECIMAL(20,2) NOT NULL,
  "sourceType" "LedgerSourceType" NOT NULL,
  "sourceRef" TEXT,
  "tradeRef" TEXT,
  "truckId" TEXT,
  "voucherId" TEXT,
  "dueDate" TIMESTAMP(3),
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CounterpartyLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CounterpartyLedgerEntry_truckId_key" ON "CounterpartyLedgerEntry"("truckId");
CREATE UNIQUE INDEX "CounterpartyLedgerEntry_voucherId_key" ON "CounterpartyLedgerEntry"("voucherId");
CREATE INDEX "CounterpartyLedgerEntry_counterpartyId_entryDate_idx"
  ON "CounterpartyLedgerEntry"("counterpartyId", "entryDate");
CREATE INDEX "CounterpartyLedgerEntry_entryType_idx" ON "CounterpartyLedgerEntry"("entryType");

ALTER TABLE "CounterpartyLedgerEntry"
  ADD CONSTRAINT "CounterpartyLedgerEntry_counterpartyId_fkey"
  FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CounterpartyLedgerEntry"
  ADD CONSTRAINT "CounterpartyLedgerEntry_voucherId_fkey"
  FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Trade booking drafts ─────────────────────────────────────────────────────
CREATE TABLE "TradeDraft" (
  "id" TEXT NOT NULL,
  "traderName" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "summary" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TradeDraft_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TradeDraft_traderName_updatedAt_idx" ON "TradeDraft"("traderName", "updatedAt");

-- ── RLS: server-only access via Prisma (table owner), same as all tables ─────
ALTER TABLE "FinancePolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Voucher" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CounterpartyLedgerEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TradeDraft" ENABLE ROW LEVEL SECURITY;
