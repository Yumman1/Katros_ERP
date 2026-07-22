-- Manual release toggle: finance/CEO approval issues the slip numbers, but
-- the truck is only Released once execution confirms the printed Gate Out
-- Slip + Delivery Order were handed to the warehouse manager.

ALTER TABLE "PendingTruck"
  ADD COLUMN "saleReleasedAt" TIMESTAMP(3),
  ADD COLUMN "saleReleasedBy" TEXT;

-- Trucks released under the old automatic behaviour stay released.
UPDATE "PendingTruck"
SET "saleReleasedAt" = now(), "saleReleasedBy" = 'auto (pre-toggle)'
WHERE "gateOutSlipNo" IS NOT NULL AND "saleReleasedAt" IS NULL;
