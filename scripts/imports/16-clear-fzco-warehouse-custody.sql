-- FZCO is a books entity. It must not own bags sitting in a Pakistan warehouse.
-- Paper/third-party holdings (holderId, no warehouse name) are kept.
-- Idempotent: safe to re-run.

DELETE FROM "SesameOwnershipEntry"
WHERE "warehouseName" IS NOT NULL
  AND btrim("warehouseName") <> '';
