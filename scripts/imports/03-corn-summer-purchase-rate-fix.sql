-- Corn Summer Purchase import — quoted-rate fix.
--
-- Live bookings store the QUOTED rate in Trade.price (₨/maund, e.g. 2245) and
-- the converted figure in pricePerCanonicalQty (₨/MT, rate × 25). The bulk
-- import put the per-MT figure in both while stamping priceWeightUnit MAUND_40,
-- so every trade displayed a rate 25× too high. Totals were unaffected — they
-- read pricePerCanonicalQty.
--
-- Idempotent: the guard `price = pricePerCanonicalQty` only matches rows still
-- carrying the import's duplicated per-MT figure; once fixed (2245 ≠ 56125)
-- the row no longer matches and a re-run changes nothing.

UPDATE "Trade"
SET price = ROUND(price / 25, 6)
WHERE "tradeRef" LIKE 'Kas-Cor26-%'
  AND "priceWeightUnit" = 'MAUND_40'
  AND price = "pricePerCanonicalQty"
  AND price > 0;

-- Verification — price must be the workbook "Rate per maund", e.g.:
--   SELECT "tradeRef", price, "pricePerCanonicalQty" FROM "Trade"
--   WHERE "tradeRef" = 'Kas-Cor26-0001';   -- 2775 / 69375
