-- IF NOT EXISTS keeps this safe when the production schema was prepared
-- through Supabase before Prisma records this migration in its own history.
ALTER TABLE "Voucher" ADD COLUMN IF NOT EXISTS "commodityCode" TEXT;
-- Linked vouchers belong to the commodity of their trade.
UPDATE "Voucher" v SET "commodityCode" = c.code
FROM "Trade" t JOIN "Commodity" c ON c.id = t."commodityId"
WHERE v."tradeRef" = t."tradeRef";
-- The prior execution desk was the corn desk. Keep its untagged advances there.
UPDATE "Voucher" SET "commodityCode" = (
  SELECT code FROM "Commodity" WHERE UPPER(code) IN ('CORN', 'CRN') ORDER BY code LIMIT 1
) WHERE "commodityCode" IS NULL AND "tradeRef" IS NULL;
CREATE INDEX IF NOT EXISTS "Voucher_commodityCode_idx" ON "Voucher"("commodityCode");
