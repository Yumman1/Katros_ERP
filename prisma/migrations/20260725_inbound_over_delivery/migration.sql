-- Inbound trucks fill exactly one purchase trade (no split). A truck that
-- delivers more than the trade's open quantity + tolerance can only be
-- accepted with the trade's trader and then the CEO approving the over-delivery.

CREATE TYPE "InboundOverStage" AS ENUM ('PENDING_TRADER', 'PENDING_CEO', 'APPROVED');

ALTER TABLE "PendingTruck"
  ADD COLUMN "overDeliveryStage" "InboundOverStage",
  ADD COLUMN "overDeliveryTradeRef" TEXT,
  ADD COLUMN "overDeliveryQtyKg" DECIMAL(20,3),
  ADD COLUMN "overDeliveryTraderBy" TEXT,
  ADD COLUMN "overDeliveryTraderAt" TIMESTAMP(3),
  ADD COLUMN "overDeliveryCeoBy" TEXT,
  ADD COLUMN "overDeliveryCeoAt" TIMESTAMP(3);
