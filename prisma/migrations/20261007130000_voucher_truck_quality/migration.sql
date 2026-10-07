-- AlterTable
ALTER TABLE "PendingTruck" ADD COLUMN     "labReadings" JSONB,
ADD COLUMN     "qualityReviewedAt" TIMESTAMP(3),
ADD COLUMN     "qualityReviewedBy" TEXT,
ADD COLUMN     "qualityTradeRef" TEXT;

-- AlterTable
ALTER TABLE "Voucher" ADD COLUMN     "purchaseProfile" TEXT,
ADD COLUMN     "truckNo" TEXT;


DROP INDEX IF EXISTS "Voucher_active_advance_builty";

-- Builty numbers can repeat across trucks; protect the exact active trip from concurrent duplicate submissions.
CREATE UNIQUE INDEX "Voucher_active_trade_builty_truck_key" ON "Voucher" ("tradeRef", "builtyNumber", "truckNo")
WHERE "status" <> 'REJECTED' AND "truckNo" IS NOT NULL AND "builtyNumber" IS NOT NULL;

UPDATE "Voucher" v SET "purchaseProfile" = c."executionProfile"::text
FROM "ExecutionContract" c WHERE c."tradeRef" = v."tradeRef" AND v."builtyNumber" IS NOT NULL;
