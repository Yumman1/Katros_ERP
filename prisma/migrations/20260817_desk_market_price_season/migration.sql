-- DeskMarketPrice: one row per commodity + season (Corn Summer / Corn Winter).

ALTER TABLE "DeskMarketPrice" ADD COLUMN IF NOT EXISTS "season" "TradeSeason" NOT NULL DEFAULT 'SUMMER';

DROP INDEX IF EXISTS "DeskMarketPrice_commodityCode_key";

CREATE UNIQUE INDEX IF NOT EXISTS "DeskMarketPrice_commodityCode_season_key"
  ON "DeskMarketPrice"("commodityCode", "season");

-- Seed Corn Winter from existing Corn row (yesterday local → 2350 for position mail).
INSERT INTO "DeskMarketPrice" (
  "id", "commodityCode", "season",
  "yestAmount", "yestCurrency", "yestUnit",
  "priceDate", "updatedAt", "updatedBy"
)
SELECT
  'desk_price_corn_winter',
  'CORN',
  'WINTER',
  2350,
  COALESCE("yestCurrency", 'PKR'),
  COALESCE("yestUnit", 'MAUND_40'),
  "priceDate",
  NOW(),
  'season-market-migration'
FROM "DeskMarketPrice"
WHERE "commodityCode" = 'CORN' AND "season" = 'SUMMER'
ON CONFLICT ("commodityCode", "season") DO UPDATE SET
  "yestAmount" = EXCLUDED."yestAmount",
  "yestCurrency" = EXCLUDED."yestCurrency",
  "yestUnit" = EXCLUDED."yestUnit",
  "updatedAt" = NOW();
