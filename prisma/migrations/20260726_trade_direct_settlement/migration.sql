-- Direct trade settlement: a trader can close a trade with no delivery and no
-- gatepass, subject to CEO approval, and only while the trade is still PENDING
-- (before it is locked).

ALTER TABLE "Trade"
  ADD COLUMN "settlementRequested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "directSettled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "settlementNote" TEXT,
  ADD COLUMN "settlementRequestedBy" TEXT,
  ADD COLUMN "settlementRequestedAt" TIMESTAMP(3),
  ADD COLUMN "settlementApprovedBy" TEXT,
  ADD COLUMN "settlementApprovedAt" TIMESTAMP(3);
