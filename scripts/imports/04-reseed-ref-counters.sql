-- Corn Summer Purchase import — reference-counter reseed.
--
-- Run this LAST, after any bulk load that carries its own reference numbers.
--
-- RefCounter hands out the next sequence for generated refs (KCS-###,
-- GP-IN-####, …). A bulk load inserts rows whose refs came from the workbook,
-- so the counters have to be moved past them or the app will re-issue a ref
-- that already exists and the insert fails on the unique constraint.
--
-- The original import set the inbound counter to the number of rows loaded
-- (409) rather than the highest number in them (416 — the workbook's KCS
-- numbers are not contiguous). Assigning the next truck asked for KCS-410,
-- which the workbook had already used, and the receipt insert failed with
-- "Unique constraint failed on the fields: (kcsNo)".
--
-- Deriving each counter from MAX(ref) in its own table is the fix: it is
-- correct regardless of gaps, how many rows loaded, or how often this runs.
-- GREATEST never moves a counter backwards, so this is safe to re-run at any
-- time — including on a database that has since issued refs of its own.

UPDATE "RefCounter" r SET value = GREATEST(r.value, c.max_ref)
FROM (
  SELECT 'inbound' AS name,
         COALESCE(MAX(NULLIF(regexp_replace("kcsNo", '\D', '', 'g'), '')::bigint), 0) AS max_ref
  FROM "InboundReceipt"
  UNION ALL
  SELECT 'gatepass-inbound',
         COALESCE(MAX(NULLIF(regexp_replace("gatepassNo", '\D', '', 'g'), '')::bigint), 0)
  FROM "PendingTruck" WHERE "movementType" = 'INBOUND'
  UNION ALL
  SELECT 'gatepass-outbound',
         COALESCE(MAX(NULLIF(regexp_replace("gatepassNo", '\D', '', 'g'), '')::bigint), 0)
  FROM "PendingTruck" WHERE "movementType" = 'OUTBOUND'
  UNION ALL
  SELECT 'payment',
         COALESCE(MAX(NULLIF(regexp_replace("requestRef", '\D', '', 'g'), '')::bigint), 0)
  FROM "PaymentRequest"
) c
WHERE r.name = c.name;

-- Verification — every counter must sit at or above the highest ref in use:
--   SELECT 'inbound', (SELECT value FROM "RefCounter" WHERE name='inbound'),
--          (SELECT MAX(NULLIF(regexp_replace("kcsNo",'\D','','g'),'')::bigint)
--           FROM "InboundReceipt");
