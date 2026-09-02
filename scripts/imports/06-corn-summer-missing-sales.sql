-- Corn Summer 26 Execution — missing sale contracts
-- Source: C:/Users/HP/Downloads/Corn Summer 26 Execution (1).xlsx
-- Idempotent: skips trades that already exist by tradeRef or contractRef

BEGIN;

-- Counterparty: Chauhan Traders
INSERT INTO "Counterparty" (
  "id","name","code","ntn","type","side","country","kycStatus","createdById","updatedAt"
) SELECT
  'imp_cp_excel_100218',
  'Chauhan Traders', '100218', '8154001-1',
  'BUYER','SELL','Pakistan','NOT_ON_FILE',
  (SELECT id FROM "User" WHERE lower(email) = lower('fahad.ahmed@kastros.co') LIMIT 1), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "Counterparty"
  WHERE code = '100218'
     OR lower(name) = lower('Chauhan Traders')
);

-- Counterparty: CHOUDHARY TRADERS
INSERT INTO "Counterparty" (
  "id","name","code","ntn","type","side","country","kycStatus","createdById","updatedAt"
) SELECT
  'imp_cp_excel_100178',
  'CHOUDHARY TRADERS', '100178', 'A043827-6',
  'BUYER','SELL','Pakistan','NOT_ON_FILE',
  (SELECT id FROM "User" WHERE lower(email) = lower('fahad.ahmed@kastros.co') LIMIT 1), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "Counterparty"
  WHERE code = '100178'
     OR lower(name) = lower('CHOUDHARY TRADERS')
);

-- Counterparty: Meskay & Femtee Trading Company (Pvt) Ltd
INSERT INTO "Counterparty" (
  "id","name","code","ntn","type","side","country","kycStatus","createdById","updatedAt"
) SELECT
  'imp_cp_excel_100310',
  'Meskay & Femtee Trading Company (Pvt) Ltd', '100310', '2739959-1',
  'BUYER','SELL','Pakistan','NOT_ON_FILE',
  (SELECT id FROM "User" WHERE lower(email) = lower('fahad.ahmed@kastros.co') LIMIT 1), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "Counterparty"
  WHERE code = '100310'
     OR lower(name) = lower('Meskay & Femtee Trading Company (Pvt) Ltd')
);

-- Counterparty: Asaaf Commission Agent
INSERT INTO "Counterparty" (
  "id","name","code","ntn","type","side","country","kycStatus","createdById","updatedAt"
) SELECT
  'imp_cp_excel_100006',
  'Asaaf Commission Agent', '100006', '5893705-1',
  'BUYER','SELL','Pakistan','NOT_ON_FILE',
  (SELECT id FROM "User" WHERE lower(email) = lower('fahad.ahmed@kastros.co') LIMIT 1), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "Counterparty"
  WHERE code = '100006'
     OR lower(name) = lower('Asaaf Commission Agent')
);

-- Sync existing KAS-2026-73 ← KAS-COR27-SAL-0001
UPDATE "Trade" SET
  "contractRef" = 'KAS-COR27-SAL-0001',
  quantity = 100,
  "ratePerMaund" = 2712.71,
  "ratePerKg" = 67.81775,
  price = 2710,
  "pricePerCanonicalQty" = 67817.75,
  "tradeStatus" = 'EXECUTED',
  "updatedAt" = NOW()
WHERE "tradeRef" = 'KAS-2026-73';

UPDATE "ExecutionContract" ec SET
  "contractualQtyMt" = 100,
  "receivedQtyMt" = 101.39,
  "openQtyMt" = 0,
  "contractStatus" = 'Close',
  "ratePerMaund" = 2712.71,
  "ratePerKg" = 67.81775,
  "unitPrice" = 2710,
  "updatedAt" = NOW()
FROM "Trade" t
WHERE ec."tradeRef" = t."tradeRef" AND t."tradeRef" = 'KAS-2026-73';

-- Sync existing KAS-2026-75 ← KAS-COR27-SAL-0002
UPDATE "Trade" SET
  "contractRef" = 'KAS-COR27-SAL-0002',
  quantity = quantity,
  "ratePerMaund" = 2699.9973,
  "ratePerKg" = 67.4999325,
  price = 2697.3,
  "pricePerCanonicalQty" = 67499.9325,
  "tradeStatus" = 'EXECUTED',
  "updatedAt" = NOW()
WHERE "tradeRef" = 'KAS-2026-75';

UPDATE "ExecutionContract" ec SET
  "contractualQtyMt" = 0,
  "receivedQtyMt" = 0,
  "openQtyMt" = 0,
  "contractStatus" = 'Close',
  "ratePerMaund" = 2699.9973,
  "ratePerKg" = 67.4999325,
  "unitPrice" = 2697.3,
  "updatedAt" = NOW()
FROM "Trade" t
WHERE ec."tradeRef" = t."tradeRef" AND t."tradeRef" = 'KAS-2026-75';

-- KAS-COR27-SAL-0003 → KAS-2026-76 (Chauhan Traders, 100 MT)
INSERT INTO "Trade" (
  "id","tradeRef","tradeDate","desk","traderName","direction","tradeScope","season",
  "commodityId","counterpartyId","counterpartyKycStatus","quantity","quantityUnit",
  "quantityEntered","quantityEnteredUnit","price","currency","priceBasis","priceCurrency",
  "priceWeightUnit","priceKgPerUnit","pricePerCanonicalQty","ratePerMaund","ratePerKg",
  "commissionPerMaund","deliveryStart","deliveryEnd","originName","destName","incoterms",
  "paymentType","paymentTerms","grade","productOrigin","qualityTolerances",
  "qualityTolerancesDetail","tradeStatus","executionProfile","submittedToExecution",
  "submittedToExecutionAt","warehouseSplitApproved","warehouseSplitApprovedAt",
  "warehouseSplitApprovedBy","lockedAt","lockedBy","contractRef","createdById","updatedAt"
) SELECT
  'imp_tr_kas_2026_76',
  'KAS-2026-76',
  '2026-08-06 00:00:00'::timestamp,
  'AGRI_DESK', (SELECT name FROM "User" WHERE lower(email) = lower('fahad.ahmed@kastros.co') LIMIT 1), 'SELL','LOCAL','SUMMER',
  (SELECT id FROM "Commodity" WHERE code = 'CORN' LIMIT 1),
  (SELECT id FROM "Counterparty" WHERE code = '100218' OR lower(name) = lower('Chauhan Traders') LIMIT 1),
  'NOT_ON_FILE',
  100, 'MT', 100, 'MT',
  2742.255, 'PKR', 'Fixed', 'PKR', 'MAUND', 40, 68624.931375,
  2744.997255, 68.624931375,
  2.742255000000114,
  '2026-08-06 00:00:00'::timestamp,
  '2026-08-20 00:00:00'::timestamp,
  'Punjab','','Ex-Warehouse','ADVANCE_100','100% Advance before delivery',
  '—','Punjab','Moisture within 10% Free',
  '{"damagePct":0,"brokenPct":0,"fungusPct":0,"foreignMatterPct":0,"moisturePct":10}'::jsonb,
  'EXECUTED', 'SALE_EX_WAREHOUSE', true, NOW(), true, NOW(),
  'corn-excel-import', NOW(), 'corn-excel-import',
  'KAS-COR27-SAL-0003',
  (SELECT id FROM "User" WHERE lower(email) = lower('fahad.ahmed@kastros.co') LIMIT 1),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = 'KAS-2026-76')
  AND NOT EXISTS (SELECT 1 FROM "Trade" WHERE "contractRef" = 'KAS-COR27-SAL-0003');

INSERT INTO "ExecutionContract" (
  "id","tradeRef","tradeId","contractDate","direction","executionProfile","tradeScope",
  "incoterms","commodityCode","commodityName","counterpartyName","counterpartyCode",
  "counterpartyNtn","quantityUnit","contractualQtyMt","receivedQtyMt","openQtyMt",
  "contractStatus","quantityToleranceMt","qualityTolerances","ratePerMaund","ratePerKg",
  "unitPrice","priceCurrency","priceWeightUnit","commissionPerMaund","currency",
  "traderName","lockedAt","lockedBy","deliveryStart","deliveryEnd","updatedAt"
) SELECT
  'imp_ec_kas_2026_76',
  'KAS-2026-76', t.id,
  t."tradeDate", 'SELL', 'SALE_EX_WAREHOUSE', 'LOCAL', 'Ex-Warehouse',
  'CORN', 'Corn', cp.name, cp.code, cp.ntn,
  'MT', 100, 101, 0,
  'Close', 10,
  '{"damagePct":0,"brokenPct":0,"fungusPct":0,"foreignMatterPct":0,"moisturePct":10}'::jsonb,
  2744.997255, 68.624931375, 2742.255, 'PKR', 'MAUND',
  2.742255000000114, 'PKR',
  (SELECT name FROM "User" WHERE lower(email) = lower('fahad.ahmed@kastros.co') LIMIT 1), t."lockedAt", 'corn-excel-import',
  t."deliveryStart", t."deliveryEnd", NOW()
FROM "Trade" t
JOIN "Counterparty" cp ON cp.id = t."counterpartyId"
WHERE t."tradeRef" = 'KAS-2026-76'
  AND NOT EXISTS (SELECT 1 FROM "ExecutionContract" WHERE "tradeRef" = 'KAS-2026-76');

-- Sync existing KAS-2026-78 ← KAS-COR27-SAL-0004
UPDATE "Trade" SET
  "contractRef" = 'KAS-COR27-SAL-0004',
  quantity = 250,
  "ratePerMaund" = 2649.99735,
  "ratePerKg" = 66.24993375,
  price = 2647.35,
  "pricePerCanonicalQty" = 66249.93375,
  "tradeStatus" = 'EXECUTED',
  "updatedAt" = NOW()
WHERE "tradeRef" = 'KAS-2026-78';

UPDATE "ExecutionContract" ec SET
  "contractualQtyMt" = 250,
  "receivedQtyMt" = 254.775,
  "openQtyMt" = 0,
  "contractStatus" = 'Close',
  "ratePerMaund" = 2649.99735,
  "ratePerKg" = 66.24993375,
  "unitPrice" = 2647.35,
  "updatedAt" = NOW()
FROM "Trade" t
WHERE ec."tradeRef" = t."tradeRef" AND t."tradeRef" = 'KAS-2026-78';

-- KAS-COR27-SAL-0005 → KAS-2026-79 (CHOUDHARY TRADERS, 300 MT)
INSERT INTO "Trade" (
  "id","tradeRef","tradeDate","desk","traderName","direction","tradeScope","season",
  "commodityId","counterpartyId","counterpartyKycStatus","quantity","quantityUnit",
  "quantityEntered","quantityEnteredUnit","price","currency","priceBasis","priceCurrency",
  "priceWeightUnit","priceKgPerUnit","pricePerCanonicalQty","ratePerMaund","ratePerKg",
  "commissionPerMaund","deliveryStart","deliveryEnd","originName","destName","incoterms",
  "paymentType","paymentTerms","grade","productOrigin","qualityTolerances",
  "qualityTolerancesDetail","tradeStatus","executionProfile","submittedToExecution",
  "submittedToExecutionAt","warehouseSplitApproved","warehouseSplitApprovedAt",
  "warehouseSplitApprovedBy","lockedAt","lockedBy","contractRef","createdById","updatedAt"
) SELECT
  'imp_tr_kas_2026_79',
  'KAS-2026-79',
  '2026-08-19 00:00:00'::timestamp,
  'AGRI_DESK', (SELECT name FROM "User" WHERE lower(email) = lower('fahad.ahmed@kastros.co') LIMIT 1), 'SELL','LOCAL','SUMMER',
  (SELECT id FROM "Commodity" WHERE code = 'CORN' LIMIT 1),
  (SELECT id FROM "Counterparty" WHERE code = '100178' OR lower(name) = lower('CHOUDHARY TRADERS') LIMIT 1),
  'NOT_ON_FILE',
  300, 'MT', 300, 'MT',
  2742.255, 'PKR', 'Fixed', 'PKR', 'MAUND', 40, 68624.931375,
  2744.997255, 68.624931375,
  2.742255000000114,
  '2026-08-19 00:00:00'::timestamp,
  '2026-09-02 00:00:00'::timestamp,
  'Punjab','','Ex-Warehouse','ADVANCE_100','100% Advance before delivery',
  '—','Punjab','Moisture within 10% Free',
  '{"damagePct":0,"brokenPct":0,"fungusPct":0,"foreignMatterPct":0,"moisturePct":10}'::jsonb,
  'LOCKED', 'SALE_EX_WAREHOUSE', true, NOW(), true, NOW(),
  'corn-excel-import', NOW(), 'corn-excel-import',
  'KAS-COR27-SAL-0005',
  (SELECT id FROM "User" WHERE lower(email) = lower('fahad.ahmed@kastros.co') LIMIT 1),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = 'KAS-2026-79')
  AND NOT EXISTS (SELECT 1 FROM "Trade" WHERE "contractRef" = 'KAS-COR27-SAL-0005');

INSERT INTO "ExecutionContract" (
  "id","tradeRef","tradeId","contractDate","direction","executionProfile","tradeScope",
  "incoterms","commodityCode","commodityName","counterpartyName","counterpartyCode",
  "counterpartyNtn","quantityUnit","contractualQtyMt","receivedQtyMt","openQtyMt",
  "contractStatus","quantityToleranceMt","qualityTolerances","ratePerMaund","ratePerKg",
  "unitPrice","priceCurrency","priceWeightUnit","commissionPerMaund","currency",
  "traderName","lockedAt","lockedBy","deliveryStart","deliveryEnd","updatedAt"
) SELECT
  'imp_ec_kas_2026_79',
  'KAS-2026-79', t.id,
  t."tradeDate", 'SELL', 'SALE_EX_WAREHOUSE', 'LOCAL', 'Ex-Warehouse',
  'CORN', 'Corn', cp.name, cp.code, cp.ntn,
  'MT', 300, 235.81, 64.19,
  'Open', 10,
  '{"damagePct":0,"brokenPct":0,"fungusPct":0,"foreignMatterPct":0,"moisturePct":10}'::jsonb,
  2744.997255, 68.624931375, 2742.255, 'PKR', 'MAUND',
  2.742255000000114, 'PKR',
  (SELECT name FROM "User" WHERE lower(email) = lower('fahad.ahmed@kastros.co') LIMIT 1), t."lockedAt", 'corn-excel-import',
  t."deliveryStart", t."deliveryEnd", NOW()
FROM "Trade" t
JOIN "Counterparty" cp ON cp.id = t."counterpartyId"
WHERE t."tradeRef" = 'KAS-2026-79'
  AND NOT EXISTS (SELECT 1 FROM "ExecutionContract" WHERE "tradeRef" = 'KAS-2026-79');

-- KAS-COR27-SAL-0006 → KAS-2026-80 (Meskay & Femtee Trading Company (Pvt) Ltd, 60 MT)
INSERT INTO "Trade" (
  "id","tradeRef","tradeDate","desk","traderName","direction","tradeScope","season",
  "commodityId","counterpartyId","counterpartyKycStatus","quantity","quantityUnit",
  "quantityEntered","quantityEnteredUnit","price","currency","priceBasis","priceCurrency",
  "priceWeightUnit","priceKgPerUnit","pricePerCanonicalQty","ratePerMaund","ratePerKg",
  "commissionPerMaund","deliveryStart","deliveryEnd","originName","destName","incoterms",
  "paymentType","paymentTerms","grade","productOrigin","qualityTolerances",
  "qualityTolerancesDetail","tradeStatus","executionProfile","submittedToExecution",
  "submittedToExecutionAt","warehouseSplitApproved","warehouseSplitApprovedAt",
  "warehouseSplitApprovedBy","lockedAt","lockedBy","contractRef","createdById","updatedAt"
) SELECT
  'imp_tr_kas_2026_80',
  'KAS-2026-80',
  '2026-08-12 00:00:00'::timestamp,
  'AGRI_DESK', (SELECT name FROM "User" WHERE lower(email) = lower('fahad.ahmed@kastros.co') LIMIT 1), 'SELL','LOCAL','SUMMER',
  (SELECT id FROM "Commodity" WHERE code = 'CORN' LIMIT 1),
  (SELECT id FROM "Counterparty" WHERE code = '100310' OR lower(name) = lower('Meskay & Femtee Trading Company (Pvt) Ltd') LIMIT 1),
  'NOT_ON_FILE',
  60, 'MT', 60, 'MT',
  2697.3, 'PKR', 'Fixed', 'PKR', 'MAUND', 40, 67499.9325,
  2699.9973, 67.4999325,
  2.6972999999998137,
  '2026-08-12 00:00:00'::timestamp,
  '2026-08-26 00:00:00'::timestamp,
  'Punjab','','Ex-Warehouse','ADVANCE_100','100% Advance before delivery',
  '—','Punjab','Moisture within 10% Free',
  '{"damagePct":0,"brokenPct":0,"fungusPct":0,"foreignMatterPct":0,"moisturePct":10}'::jsonb,
  'EXECUTED', 'SALE_EX_WAREHOUSE', true, NOW(), true, NOW(),
  'corn-excel-import', NOW(), 'corn-excel-import',
  'KAS-COR27-SAL-0006',
  (SELECT id FROM "User" WHERE lower(email) = lower('fahad.ahmed@kastros.co') LIMIT 1),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = 'KAS-2026-80')
  AND NOT EXISTS (SELECT 1 FROM "Trade" WHERE "contractRef" = 'KAS-COR27-SAL-0006');

INSERT INTO "ExecutionContract" (
  "id","tradeRef","tradeId","contractDate","direction","executionProfile","tradeScope",
  "incoterms","commodityCode","commodityName","counterpartyName","counterpartyCode",
  "counterpartyNtn","quantityUnit","contractualQtyMt","receivedQtyMt","openQtyMt",
  "contractStatus","quantityToleranceMt","qualityTolerances","ratePerMaund","ratePerKg",
  "unitPrice","priceCurrency","priceWeightUnit","commissionPerMaund","currency",
  "traderName","lockedAt","lockedBy","deliveryStart","deliveryEnd","updatedAt"
) SELECT
  'imp_ec_kas_2026_80',
  'KAS-2026-80', t.id,
  t."tradeDate", 'SELL', 'SALE_EX_WAREHOUSE', 'LOCAL', 'Ex-Warehouse',
  'CORN', 'Corn', cp.name, cp.code, cp.ntn,
  'MT', 60, 60, 0,
  'Close', 10,
  '{"damagePct":0,"brokenPct":0,"fungusPct":0,"foreignMatterPct":0,"moisturePct":10}'::jsonb,
  2699.9973, 67.4999325, 2697.3, 'PKR', 'MAUND',
  2.6972999999998137, 'PKR',
  (SELECT name FROM "User" WHERE lower(email) = lower('fahad.ahmed@kastros.co') LIMIT 1), t."lockedAt", 'corn-excel-import',
  t."deliveryStart", t."deliveryEnd", NOW()
FROM "Trade" t
JOIN "Counterparty" cp ON cp.id = t."counterpartyId"
WHERE t."tradeRef" = 'KAS-2026-80'
  AND NOT EXISTS (SELECT 1 FROM "ExecutionContract" WHERE "tradeRef" = 'KAS-2026-80');

-- KAS-COR27-SAL-0007 → KAS-2026-81 (Asaaf Commission Agent, 105 MT)
INSERT INTO "Trade" (
  "id","tradeRef","tradeDate","desk","traderName","direction","tradeScope","season",
  "commodityId","counterpartyId","counterpartyKycStatus","quantity","quantityUnit",
  "quantityEntered","quantityEnteredUnit","price","currency","priceBasis","priceCurrency",
  "priceWeightUnit","priceKgPerUnit","pricePerCanonicalQty","ratePerMaund","ratePerKg",
  "commissionPerMaund","deliveryStart","deliveryEnd","originName","destName","incoterms",
  "paymentType","paymentTerms","grade","productOrigin","qualityTolerances",
  "qualityTolerancesDetail","tradeStatus","executionProfile","submittedToExecution",
  "submittedToExecutionAt","warehouseSplitApproved","warehouseSplitApprovedAt",
  "warehouseSplitApprovedBy","lockedAt","lockedBy","contractRef","createdById","updatedAt"
) SELECT
  'imp_tr_kas_2026_81',
  'KAS-2026-81',
  '2026-07-17 00:00:00'::timestamp,
  'AGRI_DESK', (SELECT name FROM "User" WHERE lower(email) = lower('fahad.ahmed@kastros.co') LIMIT 1), 'SELL','LOCAL','WINTER',
  (SELECT id FROM "Commodity" WHERE code = 'CORN' LIMIT 1),
  (SELECT id FROM "Counterparty" WHERE code = '100006' OR lower(name) = lower('Asaaf Commission Agent') LIMIT 1),
  'NOT_ON_FILE',
  105, 'MT', 105, 'MT',
  2647.35, 'PKR', 'Fixed', 'PKR', 'MAUND', 40, 66249.93375,
  2649.99735, 66.24993375,
  2.6473500000001877,
  '2026-07-17 00:00:00'::timestamp,
  '2026-07-31 00:00:00'::timestamp,
  'Punjab','','Ex-Warehouse','ADVANCE_100','100% Advance before delivery',
  '—','Punjab','Moisture within 10% Free',
  '{"damagePct":0,"brokenPct":0,"fungusPct":0,"foreignMatterPct":0,"moisturePct":10}'::jsonb,
  'EXECUTED', 'SALE_EX_WAREHOUSE', true, NOW(), true, NOW(),
  'corn-excel-import', NOW(), 'corn-excel-import',
  'KAS-COR27-SAL-0007',
  (SELECT id FROM "User" WHERE lower(email) = lower('fahad.ahmed@kastros.co') LIMIT 1),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = 'KAS-2026-81')
  AND NOT EXISTS (SELECT 1 FROM "Trade" WHERE "contractRef" = 'KAS-COR27-SAL-0007');

INSERT INTO "ExecutionContract" (
  "id","tradeRef","tradeId","contractDate","direction","executionProfile","tradeScope",
  "incoterms","commodityCode","commodityName","counterpartyName","counterpartyCode",
  "counterpartyNtn","quantityUnit","contractualQtyMt","receivedQtyMt","openQtyMt",
  "contractStatus","quantityToleranceMt","qualityTolerances","ratePerMaund","ratePerKg",
  "unitPrice","priceCurrency","priceWeightUnit","commissionPerMaund","currency",
  "traderName","lockedAt","lockedBy","deliveryStart","deliveryEnd","updatedAt"
) SELECT
  'imp_ec_kas_2026_81',
  'KAS-2026-81', t.id,
  t."tradeDate", 'SELL', 'SALE_EX_WAREHOUSE', 'LOCAL', 'Ex-Warehouse',
  'CORN', 'Corn - Winter', cp.name, cp.code, cp.ntn,
  'MT', 105, 99.86, 0,
  'Close', 10,
  '{"damagePct":0,"brokenPct":0,"fungusPct":0,"foreignMatterPct":0,"moisturePct":10}'::jsonb,
  2649.99735, 66.24993375, 2647.35, 'PKR', 'MAUND',
  2.6473500000001877, 'PKR',
  (SELECT name FROM "User" WHERE lower(email) = lower('fahad.ahmed@kastros.co') LIMIT 1), t."lockedAt", 'corn-excel-import',
  t."deliveryStart", t."deliveryEnd", NOW()
FROM "Trade" t
JOIN "Counterparty" cp ON cp.id = t."counterpartyId"
WHERE t."tradeRef" = 'KAS-2026-81'
  AND NOT EXISTS (SELECT 1 FROM "ExecutionContract" WHERE "tradeRef" = 'KAS-2026-81');

INSERT INTO "OutboundDispatch" (
  "id","tradeRef","dispatchDate","liftedBy","buyerName","warehouseName","truckNo",
  "dispatchWeightKg","invoiceWeightKg","allocatedQtyMt","amountDue","status","remarks","updatedAt"
) SELECT
  'imp_ob_00001', 'KAS-2026-78',
  '2026-08-18 00:00:00'::timestamp,
  'Asaaf Commission Agent', 'Asaaf Commission Agent', 'Faqir Warehouse', 'E-9430',
  19170, 19170, 19.17, 1270011.2299875, 'RELEASED',
  'Excel import · KAS-COR27-SAL-0004', NOW()
WHERE EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = 'KAS-2026-78')
  AND NOT EXISTS (
    SELECT 1 FROM "OutboundDispatch"
    WHERE "tradeRef" = 'KAS-2026-78'
      AND "truckNo" = 'E-9430'
      AND "dispatchDate" = '2026-08-18 00:00:00'::timestamp
      AND "dispatchWeightKg" = 19170
  );
INSERT INTO "OutboundDispatch" (
  "id","tradeRef","dispatchDate","liftedBy","buyerName","warehouseName","truckNo",
  "dispatchWeightKg","invoiceWeightKg","allocatedQtyMt","amountDue","status","remarks","updatedAt"
) SELECT
  'imp_ob_00002', 'KAS-2026-78',
  '2026-08-18 00:00:00'::timestamp,
  'Asaaf Commission Agent', 'Asaaf Commission Agent', 'Faqir Warehouse', 'LZJ-9547',
  31170, 31170, 31.17, 2065010.4349874998, 'RELEASED',
  'Excel import · KAS-COR27-SAL-0004', NOW()
WHERE EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = 'KAS-2026-78')
  AND NOT EXISTS (
    SELECT 1 FROM "OutboundDispatch"
    WHERE "tradeRef" = 'KAS-2026-78'
      AND "truckNo" = 'LZJ-9547'
      AND "dispatchDate" = '2026-08-18 00:00:00'::timestamp
      AND "dispatchWeightKg" = 31170
  );
INSERT INTO "OutboundDispatch" (
  "id","tradeRef","dispatchDate","liftedBy","buyerName","warehouseName","truckNo",
  "dispatchWeightKg","invoiceWeightKg","allocatedQtyMt","amountDue","status","remarks","updatedAt"
) SELECT
  'imp_ob_00003', 'KAS-2026-78',
  '2026-08-19 00:00:00'::timestamp,
  'Asaaf Commission Agent', 'Asaaf Commission Agent', 'Faqir Warehouse', 'TAK-988',
  31270, 31270, 31.27, 2071635.4283625, 'RELEASED',
  'Excel import · KAS-COR27-SAL-0004', NOW()
WHERE EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = 'KAS-2026-78')
  AND NOT EXISTS (
    SELECT 1 FROM "OutboundDispatch"
    WHERE "tradeRef" = 'KAS-2026-78'
      AND "truckNo" = 'TAK-988'
      AND "dispatchDate" = '2026-08-19 00:00:00'::timestamp
      AND "dispatchWeightKg" = 31270
  );
INSERT INTO "OutboundDispatch" (
  "id","tradeRef","dispatchDate","liftedBy","buyerName","warehouseName","truckNo",
  "dispatchWeightKg","invoiceWeightKg","allocatedQtyMt","amountDue","status","remarks","updatedAt"
) SELECT
  'imp_ob_00004', 'KAS-2026-78',
  '2026-08-19 00:00:00'::timestamp,
  'Asaaf Commission Agent', 'Asaaf Commission Agent', 'Faqir Warehouse', 'CAD-2107',
  15350, 15350, 15.35, 1016936.4830624999, 'RELEASED',
  'Excel import · KAS-COR27-SAL-0004', NOW()
WHERE EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = 'KAS-2026-78')
  AND NOT EXISTS (
    SELECT 1 FROM "OutboundDispatch"
    WHERE "tradeRef" = 'KAS-2026-78'
      AND "truckNo" = 'CAD-2107'
      AND "dispatchDate" = '2026-08-19 00:00:00'::timestamp
      AND "dispatchWeightKg" = 15350
  );
INSERT INTO "OutboundDispatch" (
  "id","tradeRef","dispatchDate","liftedBy","buyerName","warehouseName","truckNo",
  "dispatchWeightKg","invoiceWeightKg","allocatedQtyMt","amountDue","status","remarks","updatedAt"
) SELECT
  'imp_ob_00005', 'KAS-2026-76',
  '2026-08-19 00:00:00'::timestamp,
  'Chauhan Traders', 'Chauhan Traders', 'Gamma Warehouse', 'SPA-500',
  51525, 51525, 51.525, 3535899.589096875, 'RELEASED',
  'Excel import · KAS-COR27-SAL-0003', NOW()
WHERE EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = 'KAS-2026-76')
  AND NOT EXISTS (
    SELECT 1 FROM "OutboundDispatch"
    WHERE "tradeRef" = 'KAS-2026-76'
      AND "truckNo" = 'SPA-500'
      AND "dispatchDate" = '2026-08-19 00:00:00'::timestamp
      AND "dispatchWeightKg" = 51525
  );
INSERT INTO "OutboundDispatch" (
  "id","tradeRef","dispatchDate","liftedBy","buyerName","warehouseName","truckNo",
  "dispatchWeightKg","invoiceWeightKg","allocatedQtyMt","amountDue","status","remarks","updatedAt"
) SELECT
  'imp_ob_00006', 'KAS-2026-78',
  '2026-08-19 00:00:00'::timestamp,
  'Asaaf Commission Agent', 'Asaaf Commission Agent', 'Faqir Warehouse', 'SLE-9520',
  36005, 36005, 36.005, 2385328.8646687497, 'RELEASED',
  'Excel import · KAS-COR27-SAL-0004', NOW()
WHERE EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = 'KAS-2026-78')
  AND NOT EXISTS (
    SELECT 1 FROM "OutboundDispatch"
    WHERE "tradeRef" = 'KAS-2026-78'
      AND "truckNo" = 'SLE-9520'
      AND "dispatchDate" = '2026-08-19 00:00:00'::timestamp
      AND "dispatchWeightKg" = 36005
  );
INSERT INTO "OutboundDispatch" (
  "id","tradeRef","dispatchDate","liftedBy","buyerName","warehouseName","truckNo",
  "dispatchWeightKg","invoiceWeightKg","allocatedQtyMt","amountDue","status","remarks","updatedAt"
) SELECT
  'imp_ob_00007', 'KAS-2026-78',
  '2026-08-19 00:00:00'::timestamp,
  'Asaaf Commission Agent', 'Asaaf Commission Agent', 'Faqir Warehouse', 'LR-8700',
  32785, 32785, 32.785, 2172004.07799375, 'RELEASED',
  'Excel import · KAS-COR27-SAL-0004', NOW()
WHERE EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = 'KAS-2026-78')
  AND NOT EXISTS (
    SELECT 1 FROM "OutboundDispatch"
    WHERE "tradeRef" = 'KAS-2026-78'
      AND "truckNo" = 'LR-8700'
      AND "dispatchDate" = '2026-08-19 00:00:00'::timestamp
      AND "dispatchWeightKg" = 32785
  );
-- Skip outbound KAS-COR27-SAL-0006: Meskay lift is ex-buyer stock, not a company warehouse
INSERT INTO "OutboundDispatch" (
  "id","tradeRef","dispatchDate","liftedBy","buyerName","warehouseName","truckNo",
  "dispatchWeightKg","invoiceWeightKg","allocatedQtyMt","amountDue","status","remarks","updatedAt"
) SELECT
  'imp_ob_00009', 'KAS-2026-81',
  '2026-08-20 00:00:00'::timestamp,
  'Asaaf Commission Agent', 'Asaaf Commission Agent', 'Faqir Warehouse', 'TKL-665',
  21980, 21980, 21.98, 1456173.5438249998, 'RELEASED',
  'Excel import · KAS-COR27-SAL-0007', NOW()
WHERE EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = 'KAS-2026-81')
  AND NOT EXISTS (
    SELECT 1 FROM "OutboundDispatch"
    WHERE "tradeRef" = 'KAS-2026-81'
      AND "truckNo" = 'TKL-665'
      AND "dispatchDate" = '2026-08-20 00:00:00'::timestamp
      AND "dispatchWeightKg" = 21980
  );
INSERT INTO "OutboundDispatch" (
  "id","tradeRef","dispatchDate","liftedBy","buyerName","warehouseName","truckNo",
  "dispatchWeightKg","invoiceWeightKg","allocatedQtyMt","amountDue","status","remarks","updatedAt"
) SELECT
  'imp_ob_00010', 'KAS-2026-79',
  '2026-08-20 00:00:00'::timestamp,
  'CHOUDHARY TRADERS', 'CHOUDHARY TRADERS', 'Gamma Warehouse', 'TKV-341',
  18810, 18810, 18.81, 1290834.95916375, 'RELEASED',
  'Excel import · KAS-COR27-SAL-0005', NOW()
WHERE EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = 'KAS-2026-79')
  AND NOT EXISTS (
    SELECT 1 FROM "OutboundDispatch"
    WHERE "tradeRef" = 'KAS-2026-79'
      AND "truckNo" = 'TKV-341'
      AND "dispatchDate" = '2026-08-20 00:00:00'::timestamp
      AND "dispatchWeightKg" = 18810
  );
INSERT INTO "OutboundDispatch" (
  "id","tradeRef","dispatchDate","liftedBy","buyerName","warehouseName","truckNo",
  "dispatchWeightKg","invoiceWeightKg","allocatedQtyMt","amountDue","status","remarks","updatedAt"
) SELECT
  'imp_ob_00011', 'KAS-2026-79',
  '2026-08-20 00:00:00'::timestamp,
  'CHOUDHARY TRADERS', 'CHOUDHARY TRADERS', 'Gamma Warehouse', 'MND-5154',
  16460, 16460, 16.46, 1129566.3704325, 'RELEASED',
  'Excel import · KAS-COR27-SAL-0005', NOW()
WHERE EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = 'KAS-2026-79')
  AND NOT EXISTS (
    SELECT 1 FROM "OutboundDispatch"
    WHERE "tradeRef" = 'KAS-2026-79'
      AND "truckNo" = 'MND-5154'
      AND "dispatchDate" = '2026-08-20 00:00:00'::timestamp
      AND "dispatchWeightKg" = 16460
  );
INSERT INTO "OutboundDispatch" (
  "id","tradeRef","dispatchDate","liftedBy","buyerName","warehouseName","truckNo",
  "dispatchWeightKg","invoiceWeightKg","allocatedQtyMt","amountDue","status","remarks","updatedAt"
) SELECT
  'imp_ob_00012', 'KAS-2026-76',
  '2026-08-20 00:00:00'::timestamp,
  'Chauhan Traders', 'Chauhan Traders', 'Gamma Warehouse', 'TLD-995',
  49475, 49475, 49.475, 3395218.479778125, 'RELEASED',
  'Excel import · KAS-COR27-SAL-0003', NOW()
WHERE EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = 'KAS-2026-76')
  AND NOT EXISTS (
    SELECT 1 FROM "OutboundDispatch"
    WHERE "tradeRef" = 'KAS-2026-76'
      AND "truckNo" = 'TLD-995'
      AND "dispatchDate" = '2026-08-20 00:00:00'::timestamp
      AND "dispatchWeightKg" = 49475
  );
INSERT INTO "OutboundDispatch" (
  "id","tradeRef","dispatchDate","liftedBy","buyerName","warehouseName","truckNo",
  "dispatchWeightKg","invoiceWeightKg","allocatedQtyMt","amountDue","status","remarks","updatedAt"
) SELECT
  'imp_ob_00013', 'KAS-2026-81',
  '2026-08-21 00:00:00'::timestamp,
  'Asaaf Commission Agent', 'Asaaf Commission Agent', 'Faqir Warehouse', 'JW-1396',
  26170, 26170, 26.17, 1733760.7662375, 'RELEASED',
  'Excel import · KAS-COR27-SAL-0007', NOW()
WHERE EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = 'KAS-2026-81')
  AND NOT EXISTS (
    SELECT 1 FROM "OutboundDispatch"
    WHERE "tradeRef" = 'KAS-2026-81'
      AND "truckNo" = 'JW-1396'
      AND "dispatchDate" = '2026-08-21 00:00:00'::timestamp
      AND "dispatchWeightKg" = 26170
  );
INSERT INTO "OutboundDispatch" (
  "id","tradeRef","dispatchDate","liftedBy","buyerName","warehouseName","truckNo",
  "dispatchWeightKg","invoiceWeightKg","allocatedQtyMt","amountDue","status","remarks","updatedAt"
) SELECT
  'imp_ob_00014', 'KAS-2026-78',
  '2026-08-21 00:00:00'::timestamp,
  'Asaaf Commission Agent', 'Asaaf Commission Agent', 'Faqir Warehouse', 'C-1747',
  24435, 24435, 24.435, 1618817.1311812499, 'RELEASED',
  'Excel import · KAS-COR27-SAL-0004', NOW()
WHERE EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = 'KAS-2026-78')
  AND NOT EXISTS (
    SELECT 1 FROM "OutboundDispatch"
    WHERE "tradeRef" = 'KAS-2026-78'
      AND "truckNo" = 'C-1747'
      AND "dispatchDate" = '2026-08-21 00:00:00'::timestamp
      AND "dispatchWeightKg" = 24435
  );
INSERT INTO "OutboundDispatch" (
  "id","tradeRef","dispatchDate","liftedBy","buyerName","warehouseName","truckNo",
  "dispatchWeightKg","invoiceWeightKg","allocatedQtyMt","amountDue","status","remarks","updatedAt"
) SELECT
  'imp_ob_00015', 'KAS-2026-78',
  '2026-08-21 00:00:00'::timestamp,
  'Asaaf Commission Agent', 'Asaaf Commission Agent', 'Faqir Warehouse', 'FDI-174',
  23460, 23460, 23.46, 1554223.445775, 'RELEASED',
  'Excel import · KAS-COR27-SAL-0004', NOW()
WHERE EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = 'KAS-2026-78')
  AND NOT EXISTS (
    SELECT 1 FROM "OutboundDispatch"
    WHERE "tradeRef" = 'KAS-2026-78'
      AND "truckNo" = 'FDI-174'
      AND "dispatchDate" = '2026-08-21 00:00:00'::timestamp
      AND "dispatchWeightKg" = 23460
  );
INSERT INTO "OutboundDispatch" (
  "id","tradeRef","dispatchDate","liftedBy","buyerName","warehouseName","truckNo",
  "dispatchWeightKg","invoiceWeightKg","allocatedQtyMt","amountDue","status","remarks","updatedAt"
) SELECT
  'imp_ob_00016', 'KAS-2026-78',
  '2026-08-21 00:00:00'::timestamp,
  'Asaaf Commission Agent', 'Asaaf Commission Agent', 'Faqir Warehouse', 'TKA-427',
  21865, 21865, 21.865, 1448554.80144375, 'RELEASED',
  'Excel import · KAS-COR27-SAL-0004', NOW()
WHERE EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = 'KAS-2026-78')
  AND NOT EXISTS (
    SELECT 1 FROM "OutboundDispatch"
    WHERE "tradeRef" = 'KAS-2026-78'
      AND "truckNo" = 'TKA-427'
      AND "dispatchDate" = '2026-08-21 00:00:00'::timestamp
      AND "dispatchWeightKg" = 21865
  );
INSERT INTO "OutboundDispatch" (
  "id","tradeRef","dispatchDate","liftedBy","buyerName","warehouseName","truckNo",
  "dispatchWeightKg","invoiceWeightKg","allocatedQtyMt","amountDue","status","remarks","updatedAt"
) SELECT
  'imp_ob_00017', 'KAS-2026-79',
  '2026-08-21 00:00:00'::timestamp,
  'CHOUDHARY TRADERS', 'CHOUDHARY TRADERS', 'Gamma Warehouse', 'MNK-7316',
  34880, 34880, 34.88, 2393637.60636, 'RELEASED',
  'Excel import · KAS-COR27-SAL-0005', NOW()
WHERE EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = 'KAS-2026-79')
  AND NOT EXISTS (
    SELECT 1 FROM "OutboundDispatch"
    WHERE "tradeRef" = 'KAS-2026-79'
      AND "truckNo" = 'MNK-7316'
      AND "dispatchDate" = '2026-08-21 00:00:00'::timestamp
      AND "dispatchWeightKg" = 34880
  );
INSERT INTO "OutboundDispatch" (
  "id","tradeRef","dispatchDate","liftedBy","buyerName","warehouseName","truckNo",
  "dispatchWeightKg","invoiceWeightKg","allocatedQtyMt","amountDue","status","remarks","updatedAt"
) SELECT
  'imp_ob_00018', 'KAS-2026-81',
  '2026-08-22 00:00:00'::timestamp,
  'Asaaf Commission Agent', 'Asaaf Commission Agent', 'Faqir Warehouse', 'BLN-310',
  22505, 22505, 22.505, 1490954.75904375, 'RELEASED',
  'Excel import · KAS-COR27-SAL-0007', NOW()
WHERE EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = 'KAS-2026-81')
  AND NOT EXISTS (
    SELECT 1 FROM "OutboundDispatch"
    WHERE "tradeRef" = 'KAS-2026-81'
      AND "truckNo" = 'BLN-310'
      AND "dispatchDate" = '2026-08-22 00:00:00'::timestamp
      AND "dispatchWeightKg" = 22505
  );
INSERT INTO "OutboundDispatch" (
  "id","tradeRef","dispatchDate","liftedBy","buyerName","warehouseName","truckNo",
  "dispatchWeightKg","invoiceWeightKg","allocatedQtyMt","amountDue","status","remarks","updatedAt"
) SELECT
  'imp_ob_00019', 'KAS-2026-79',
  '2026-08-22 00:00:00'::timestamp,
  'CHOUDHARY TRADERS', 'CHOUDHARY TRADERS', 'Gamma Warehouse', 'LEI-3434',
  38175, 38175, 38.175, 2619756.7552406252, 'RELEASED',
  'Excel import · KAS-COR27-SAL-0005', NOW()
WHERE EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = 'KAS-2026-79')
  AND NOT EXISTS (
    SELECT 1 FROM "OutboundDispatch"
    WHERE "tradeRef" = 'KAS-2026-79'
      AND "truckNo" = 'LEI-3434'
      AND "dispatchDate" = '2026-08-22 00:00:00'::timestamp
      AND "dispatchWeightKg" = 38175
  );
INSERT INTO "OutboundDispatch" (
  "id","tradeRef","dispatchDate","liftedBy","buyerName","warehouseName","truckNo",
  "dispatchWeightKg","invoiceWeightKg","allocatedQtyMt","amountDue","status","remarks","updatedAt"
) SELECT
  'imp_ob_00020', 'KAS-2026-81',
  '2026-08-22 00:00:00'::timestamp,
  'Asaaf Commission Agent', 'Asaaf Commission Agent', 'Faqir Warehouse', 'TAQ-863',
  29205, 29205, 29.205, 1934829.31516875, 'RELEASED',
  'Excel import · KAS-COR27-SAL-0007', NOW()
WHERE EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = 'KAS-2026-81')
  AND NOT EXISTS (
    SELECT 1 FROM "OutboundDispatch"
    WHERE "tradeRef" = 'KAS-2026-81'
      AND "truckNo" = 'TAQ-863'
      AND "dispatchDate" = '2026-08-22 00:00:00'::timestamp
      AND "dispatchWeightKg" = 29205
  );
INSERT INTO "OutboundDispatch" (
  "id","tradeRef","dispatchDate","liftedBy","buyerName","warehouseName","truckNo",
  "dispatchWeightKg","invoiceWeightKg","allocatedQtyMt","amountDue","status","remarks","updatedAt"
) SELECT
  'imp_ob_00021', 'KAS-2026-79',
  '2026-08-22 00:00:00'::timestamp,
  'CHOUDHARY TRADERS', 'CHOUDHARY TRADERS', 'Gamma Warehouse', 'E-2020',
  32155, 32155, 32.155, 2206634.668363125, 'RELEASED',
  'Excel import · KAS-COR27-SAL-0005', NOW()
WHERE EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = 'KAS-2026-79')
  AND NOT EXISTS (
    SELECT 1 FROM "OutboundDispatch"
    WHERE "tradeRef" = 'KAS-2026-79'
      AND "truckNo" = 'E-2020'
      AND "dispatchDate" = '2026-08-22 00:00:00'::timestamp
      AND "dispatchWeightKg" = 32155
  );
INSERT INTO "OutboundDispatch" (
  "id","tradeRef","dispatchDate","liftedBy","buyerName","warehouseName","truckNo",
  "dispatchWeightKg","invoiceWeightKg","allocatedQtyMt","amountDue","status","remarks","updatedAt"
) SELECT
  'imp_ob_00022', 'KAS-2026-79',
  '2026-08-23 00:00:00'::timestamp,
  'CHOUDHARY TRADERS', 'CHOUDHARY TRADERS', 'Gamma Warehouse', 'LEI-665',
  34190, 34190, 34.19, 2346286.40371125, 'RELEASED',
  'Excel import · KAS-COR27-SAL-0005', NOW()
WHERE EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = 'KAS-2026-79')
  AND NOT EXISTS (
    SELECT 1 FROM "OutboundDispatch"
    WHERE "tradeRef" = 'KAS-2026-79'
      AND "truckNo" = 'LEI-665'
      AND "dispatchDate" = '2026-08-23 00:00:00'::timestamp
      AND "dispatchWeightKg" = 34190
  );
INSERT INTO "OutboundDispatch" (
  "id","tradeRef","dispatchDate","liftedBy","buyerName","warehouseName","truckNo",
  "dispatchWeightKg","invoiceWeightKg","allocatedQtyMt","amountDue","status","remarks","updatedAt"
) SELECT
  'imp_ob_00023', 'KAS-2026-79',
  '2026-08-23 00:00:00'::timestamp,
  'CHOUDHARY TRADERS', 'CHOUDHARY TRADERS', 'Gamma Warehouse', 'SAI-156',
  28700, 28700, 28.7, 1969535.5304625002, 'RELEASED',
  'Excel import · KAS-COR27-SAL-0005', NOW()
WHERE EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = 'KAS-2026-79')
  AND NOT EXISTS (
    SELECT 1 FROM "OutboundDispatch"
    WHERE "tradeRef" = 'KAS-2026-79'
      AND "truckNo" = 'SAI-156'
      AND "dispatchDate" = '2026-08-23 00:00:00'::timestamp
      AND "dispatchWeightKg" = 28700
  );
INSERT INTO "OutboundDispatch" (
  "id","tradeRef","dispatchDate","liftedBy","buyerName","warehouseName","truckNo",
  "dispatchWeightKg","invoiceWeightKg","allocatedQtyMt","amountDue","status","remarks","updatedAt"
) SELECT
  'imp_ob_00024', 'KAS-2026-78',
  '2026-08-23 00:00:00'::timestamp,
  'Asaaf Commission Agent', 'Asaaf Commission Agent', 'Faqir Warehouse', 'TAN-419',
  19265, 19265, 19.265, 1276304.9736937499, 'RELEASED',
  'Excel import · KAS-COR27-SAL-0004', NOW()
WHERE EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = 'KAS-2026-78')
  AND NOT EXISTS (
    SELECT 1 FROM "OutboundDispatch"
    WHERE "tradeRef" = 'KAS-2026-78'
      AND "truckNo" = 'TAN-419'
      AND "dispatchDate" = '2026-08-23 00:00:00'::timestamp
      AND "dispatchWeightKg" = 19265
  );
INSERT INTO "OutboundDispatch" (
  "id","tradeRef","dispatchDate","liftedBy","buyerName","warehouseName","truckNo",
  "dispatchWeightKg","invoiceWeightKg","allocatedQtyMt","amountDue","status","remarks","updatedAt"
) SELECT
  'imp_ob_00025', 'KAS-2026-79',
  '2026-08-24 00:00:00'::timestamp,
  'CHOUDHARY TRADERS', 'CHOUDHARY TRADERS', 'Gamma Warehouse', 'SGG-536',
  32440, 32440, 32.44, 2226192.773805, 'RELEASED',
  'Excel import · KAS-COR27-SAL-0005', NOW()
WHERE EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = 'KAS-2026-79')
  AND NOT EXISTS (
    SELECT 1 FROM "OutboundDispatch"
    WHERE "tradeRef" = 'KAS-2026-79'
      AND "truckNo" = 'SGG-536'
      AND "dispatchDate" = '2026-08-24 00:00:00'::timestamp
      AND "dispatchWeightKg" = 32440
  );

-- Bump trade ref counter past KAS-2026-81
INSERT INTO "RefCounter" ("name","value") VALUES ('trade', 81)
ON CONFLICT ("name") DO UPDATE SET "value" = GREATEST("RefCounter"."value", 81);

COMMIT;
