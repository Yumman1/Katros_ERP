-- Corn Summer Excel reconciliation (Aug 2026)
-- Source workbooks:
--   Corn Summer - Purchase (2).xlsx
--   Corn Summer 26 Execution.xlsx
--
-- Idempotent where noted. Run once against live Supabase after review.

BEGIN;

-- 1. Missing inbound KCS-424 for Kas-Cor26-0067 (+24.785 MT)
INSERT INTO "InboundReceipt" (
  "id","kcsNo","tradeRef","receiveDate","truckNo","biltyNo","trnNo",
  "warehouseName","sellerName","bags","weightSpotKg","weightWarehouseKg","weightDiffKg",
  "allocatedQtyMt","amountDue","paidAmountPkr","status","updatedAt"
) VALUES (
  'sync_rc_kcs_424','KCS-424','Kas-Cor26-0067','2026-08-02 00:00:00','CAG-7740','451','435',
  'Umar Warehouse','IDREES AND SONS COMMISSION AGENT',496,24785,24785,0,
  24.785,1397254.375,0,'ALLOCATED',NOW()
) ON CONFLICT ("kcsNo") DO NOTHING;

-- 2. Kas-Cor26-0066: contractual qty 150 → 104, close
UPDATE "Trade" SET quantity = 104, "updatedAt" = NOW() WHERE "tradeRef" = 'Kas-Cor26-0066';
UPDATE "ExecutionContract"
SET "contractualQtyMt" = 104, "receivedQtyMt" = 103.815, "openQtyMt" = 0,
    "contractStatus" = 'Close', "updatedAt" = NOW()
WHERE "tradeRef" = 'Kas-Cor26-0066';
UPDATE "Trade" SET "tradeStatus" = 'EXECUTED', "updatedAt" = NOW() WHERE "tradeRef" = 'Kas-Cor26-0066';

-- 3. Kas-Cor26-0067: close after KCS-424
UPDATE "ExecutionContract"
SET "receivedQtyMt" = 189.055, "openQtyMt" = 0, "contractStatus" = 'Close', "updatedAt" = NOW()
WHERE "tradeRef" = 'Kas-Cor26-0067';
UPDATE "Trade" SET "tradeStatus" = 'EXECUTED', "updatedAt" = NOW() WHERE "tradeRef" = 'Kas-Cor26-0067';

-- 4. Zero stale openQty on closed purchase contracts
UPDATE "ExecutionContract" ec
SET "openQtyMt" = 0, "updatedAt" = NOW()
FROM "Trade" t
WHERE t."tradeRef" = ec."tradeRef"
  AND t."tradeRef" LIKE 'Kas-Cor26-%'
  AND ec."contractStatus" = 'Close'
  AND ec."openQtyMt" > 0;

-- 5. Close KAS-2026-73 (Excel KAS-COR27-SAL-0001, 101.39 MT executed)
UPDATE "Trade"
SET "tradeStatus" = 'EXECUTED', "contractRef" = 'KAS-COR27-SAL-0001', "updatedAt" = NOW()
WHERE "tradeRef" = 'KAS-2026-73';
UPDATE "ExecutionContract"
SET "contractStatus" = 'Close', "openQtyMt" = 0, "receivedQtyMt" = 101.39, "updatedAt" = NOW()
WHERE "tradeRef" = 'KAS-2026-73';

-- 6. KAS-2026-75 → Excel SAL-0002 (ISHAQ, rate 2700)
UPDATE "Trade" SET
  "counterpartyId" = 'imp_cp_0010',
  "ratePerMaund" = 2700, "ratePerKg" = 67.5,
  price = 2700, "pricePerCanonicalQty" = 67500,
  "contractRef" = 'KAS-COR27-SAL-0002', "updatedAt" = NOW()
WHERE "tradeRef" = 'KAS-2026-75';
UPDATE "ExecutionContract" SET
  "counterpartyName" = 'ISHAQ AND SONS AGRI PRODUCE COMMISSION AGENT',
  "counterpartyCode" = '100227', "counterpartyNtn" = '3821447-4',
  "ratePerMaund" = 2700, "ratePerKg" = 67.5, "unitPrice" = 2700, "updatedAt" = NOW()
WHERE "tradeRef" = 'KAS-2026-75';

-- 7. Corn Winter: Kisan Godam transfers total 101.27 → 105 MT (SHF-00004 +3.73)
UPDATE "StockTransfer"
SET "receivedQtyMt" = 32.105, "dispatchedQtyMt" = 32.105, "updatedAt" = NOW()
WHERE "transferRef" = 'SHF-00004';

COMMIT;
