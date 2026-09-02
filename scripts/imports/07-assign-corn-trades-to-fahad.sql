-- Assign all Corn trades to Fahad Ahmed (fahad.ahmed@kastros.co) for trader My Trades + Fulfillment.
-- Idempotent: safe to re-run after imports.

BEGIN;

UPDATE "Trade" t
SET
  "traderName" = (SELECT name FROM "User" WHERE lower(email) = lower('fahad.ahmed@kastros.co') LIMIT 1),
  "createdById" = (SELECT id FROM "User" WHERE lower(email) = lower('fahad.ahmed@kastros.co') LIMIT 1),
  "updatedAt" = NOW()
WHERE (
  t."tradeRef" ILIKE 'Kas-Cor26-%'
  OR EXISTS (
    SELECT 1 FROM "Commodity" c
    WHERE c.id = t."commodityId" AND c.code = 'CORN'
  )
)
AND EXISTS (SELECT 1 FROM "User" WHERE lower(email) = lower('fahad.ahmed@kastros.co'));

UPDATE "ExecutionContract" ec
SET
  "traderName" = (SELECT name FROM "User" WHERE lower(email) = lower('fahad.ahmed@kastros.co') LIMIT 1),
  "updatedAt" = NOW()
FROM "Trade" t
WHERE ec."tradeRef" = t."tradeRef"
  AND (
    t."tradeRef" ILIKE 'Kas-Cor26-%'
    OR EXISTS (
      SELECT 1 FROM "Commodity" c
      WHERE c.id = t."commodityId" AND c.code = 'CORN'
    )
  )
AND EXISTS (SELECT 1 FROM "User" WHERE lower(email) = lower('fahad.ahmed@kastros.co'));

COMMIT;
