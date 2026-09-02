/**
 * Generate idempotent SQL to import missing sale contracts + outbound dispatches.
 *   npx tsx scripts/generate-missing-sales-sql.ts > scripts/imports/06-corn-summer-missing-sales.sql
 */
import * as fs from "node:fs";
import XLSX from "xlsx";
import {
  CORN_TRADER_NAME_SQL,
  CORN_TRADER_USER_ID_SQL,
} from "./lib/corn-trader";

const EXECUTION_XLSX =
  process.env.CORN_EXECUTION_XLSX ??
  "C:/Users/HP/Downloads/Corn Summer 26 Execution (1).xlsx";

const EXISTING: Record<string, string> = {
  "KAS-COR27-SAL-0001": "KAS-2026-73",
  "KAS-COR27-SAL-0002": "KAS-2026-75",
  "KAS-COR27-SAL-0004": "KAS-2026-78",
};

/** New trades to insert (contractNo → tradeRef) */
const NEW_TRADE_REFS: Record<string, string> = {
  "KAS-COR27-SAL-0003": "KAS-2026-76",
  "KAS-COR27-SAL-0005": "KAS-2026-79",
  "KAS-COR27-SAL-0006": "KAS-2026-80",
  "KAS-COR27-SAL-0007": "KAS-2026-81",
};

const CP_OVERRIDES: Record<string, { cpId: string; buyer: string; ntn?: string }> = {
  "KAS-COR27-SAL-0006": {
    cpId: "100310",
    buyer: "Meskay & Femtee Trading Company (Pvt) Ltd",
    ntn: "2739959-1",
  },
};

const WH_MAP: Record<string, string> = {
  gama: "Gamma Warehouse",
  gamma: "Gamma Warehouse",
  fareeq: "Faqir Warehouse",
  "fareeq warehouse": "Faqir Warehouse",
  "gama warehouse": "Gamma Warehouse",
  faqir: "Faqir Warehouse",
  fakeer: "Faqir Warehouse",
  faqeer: "Faqir Warehouse",
  umer: "Umar Warehouse",
  umar: "Umar Warehouse",
};

/** Only these warehouses exist in Location master and affect company stock. */
const COMPANY_WAREHOUSES = new Set([
  "Faqir Warehouse",
  "Gamma Warehouse",
  "Umar Warehouse",
]);

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string => (v == null ? "" : String(v).trim());
const sqlStr = (s: string) => `'${s.replace(/'/g, "''")}'`;

function excelDateToJs(v: unknown): Date | null {
  if (v instanceof Date) return v;
  const n = num(v);
  if (n == null) return null;
  return new Date(Date.UTC(1899, 11, 30) + n * 86400000);
}

function fmtTs(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

type SaleRow = {
  contractNo: string;
  tradeDate: Date;
  buyer: string;
  cpId: string | null;
  ntn: string | null;
  commodity: string;
  finalQty: number;
  rateMd: number;
  netRate: number;
  executed: number;
  open: number;
  status: string;
  deliveryEnd: Date | null;
  season: "SUMMER" | "WINTER";
};

function parseSales(): SaleRow[] {
  const wb = XLSX.readFile(EXECUTION_XLSX);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Sale Contract"], {
    header: 1,
    defval: "",
  });
  const out: SaleRow[] = [];
  for (const r of rows) {
    const contractNo = str(r[2]);
    if (!contractNo.startsWith("KAS-COR")) continue;
    const tradeDate = excelDateToJs(r[1]);
    if (!tradeDate) continue;
    const commodity = str(r[7]);
    out.push({
      contractNo,
      tradeDate,
      buyer: CP_OVERRIDES[contractNo]?.buyer ?? str(r[3]),
      cpId: CP_OVERRIDES[contractNo]?.cpId ?? (str(r[4]) || null),
      ntn: CP_OVERRIDES[contractNo]?.ntn ?? (str(r[5]) || null),
      commodity,
      finalQty: num(r[10]) ?? num(r[9]) ?? 0,
      rateMd: num(r[11]) ?? 0,
      netRate: num(r[14]) ?? num(r[11]) ?? 0,
      executed: num(r[15]) ?? 0,
      open: num(r[16]) ?? 0,
      status: str(r[17]),
      deliveryEnd: excelDateToJs(r[19]),
      season: /winter/i.test(commodity) ? "WINTER" : "SUMMER",
    });
  }
  return out;
}

type OutRow = {
  contractNo: string;
  dispatchDate: Date;
  buyer: string;
  warehouse: string;
  truckNo: string;
  weightKg: number;
  rateMd: number;
  amount: number;
};

function parseOutbound(): OutRow[] {
  const wb = XLSX.readFile(EXECUTION_XLSX);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Outbound"], {
    header: 1,
    defval: "",
  });
  const out: OutRow[] = [];
  for (const r of rows.slice(3)) {
    const contractNo = str(r[6]);
    if (!contractNo.startsWith("KAS-COR")) continue;
    const dispatchDate = excelDateToJs(r[1]);
    const weightKg = num(r[12]) ?? num(r[14]) ?? 0;
    if (!dispatchDate || weightKg <= 0) continue;
    out.push({
      contractNo,
      dispatchDate,
      buyer: str(r[4]),
      warehouse: WH_MAP[str(r[9]).trim().toLowerCase()] ?? str(r[9]).trim(),
      truckNo: str(r[11]) || "-",
      weightKg,
      rateMd: num(r[7]) ?? 0,
      amount: num(r[20]) ?? 0,
    });
  }
  return out;
}

function cpLookup(row: SaleRow): string {
  if (row.cpId) {
    return `(SELECT id FROM "Counterparty" WHERE code = ${sqlStr(row.cpId)} OR lower(name) = lower(${sqlStr(row.buyer)}) LIMIT 1)`;
  }
  return `(SELECT id FROM "Counterparty" WHERE lower(name) = lower(${sqlStr(row.buyer)}) LIMIT 1)`;
}

function main(): void {
  if (!fs.existsSync(EXECUTION_XLSX)) throw new Error(`Missing ${EXECUTION_XLSX}`);
  const sales = parseSales();
  const outbound = parseOutbound();

  console.log("-- Corn Summer 26 Execution — missing sale contracts");
  console.log(`-- Source: ${EXECUTION_XLSX}`);
  console.log("-- Idempotent: skips trades that already exist by tradeRef or contractRef\n");
  console.log("BEGIN;\n");

  // Ensure counterparties referenced by new sale contracts exist
  const cpRows = new Map<string, { name: string; code: string | null; ntn: string | null }>();
  for (const row of sales) {
    if (EXISTING[row.contractNo] || !NEW_TRADE_REFS[row.contractNo]) continue;
    const key = row.cpId ?? row.buyer.toLowerCase();
    cpRows.set(key, { name: row.buyer, code: row.cpId, ntn: row.ntn });
  }
  for (const cp of cpRows.values()) {
    const code = cp.code ?? `CP-EXCEL-${cp.name.slice(0, 12).replace(/\W/g, "").toUpperCase()}`;
    console.log(`-- Counterparty: ${cp.name}`);
    console.log(`INSERT INTO "Counterparty" (
  "id","name","code","ntn","type","side","country","kycStatus","createdById","updatedAt"
) SELECT
  ${sqlStr(`imp_cp_excel_${code.replace(/\W/g, "_")}`)},
  ${sqlStr(cp.name)}, ${sqlStr(code)}, ${cp.ntn ? sqlStr(cp.ntn) : "NULL"},
  'BUYER','SELL','Pakistan','NOT_ON_FILE',
  (SELECT id FROM "User" ORDER BY "createdAt" LIMIT 1), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "Counterparty"
  WHERE code = ${sqlStr(code)}
     OR lower(name) = lower(${sqlStr(cp.name)})
);\n`);
  }

  for (const row of sales) {
    const existingRef = EXISTING[row.contractNo];
    const newRef = NEW_TRADE_REFS[row.contractNo];
    const tradeRef = existingRef ?? newRef;
    if (!tradeRef) continue;

    const closed = row.status.toLowerCase() === "closed" || row.open <= 0.001;
    const tradeStatus = closed ? "EXECUTED" : "LOCKED";
    const contractStatus = closed ? "Close" : "Open";
    const rateKg = row.netRate / 40;
    const deliveryEnd = row.deliveryEnd ?? new Date(row.tradeDate.getTime() + 14 * 86400000);

    if (newRef) {
      console.log(`-- ${row.contractNo} → ${newRef} (${row.buyer}, ${row.finalQty} MT)`);
      console.log(`INSERT INTO "Trade" (
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
  ${sqlStr(`imp_tr_${newRef.replace(/-/g, "_").toLowerCase()}`)},
  ${sqlStr(newRef)},
  ${sqlStr(fmtTs(row.tradeDate))}::timestamp,
  'AGRI_DESK',${CORN_TRADER_NAME_SQL},'SELL','LOCAL',${sqlStr(row.season)},
  (SELECT id FROM "Commodity" WHERE code = 'CORN' LIMIT 1),
  ${cpLookup(row)},
  'NOT_ON_FILE',
  ${row.finalQty}, 'MT', ${row.finalQty}, 'MT',
  ${row.rateMd}, 'PKR', 'Fixed', 'PKR', 'MAUND', 40, ${rateKg * 1000},
  ${row.netRate}, ${rateKg},
  ${Math.max(0, row.netRate - row.rateMd)},
  ${sqlStr(fmtTs(row.tradeDate))}::timestamp,
  ${sqlStr(fmtTs(deliveryEnd))}::timestamp,
  'Punjab','','Ex-Warehouse','ADVANCE_100','100% Advance before delivery',
  '—','Punjab','Moisture within 10% Free',
  '{"damagePct":0,"brokenPct":0,"fungusPct":0,"foreignMatterPct":0,"moisturePct":10}'::jsonb,
  ${sqlStr(tradeStatus)}, 'SALE_EX_WAREHOUSE', true, NOW(), true, NOW(),
  'corn-excel-import', NOW(), 'corn-excel-import',
  ${sqlStr(row.contractNo)},
  ${CORN_TRADER_USER_ID_SQL},
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = ${sqlStr(newRef)})
  AND NOT EXISTS (SELECT 1 FROM "Trade" WHERE "contractRef" = ${sqlStr(row.contractNo)});\n`);

      console.log(`INSERT INTO "ExecutionContract" (
  "id","tradeRef","tradeId","contractDate","direction","executionProfile","tradeScope",
  "incoterms","commodityCode","commodityName","counterpartyName","counterpartyCode",
  "counterpartyNtn","quantityUnit","contractualQtyMt","receivedQtyMt","openQtyMt",
  "contractStatus","quantityToleranceMt","qualityTolerances","ratePerMaund","ratePerKg",
  "unitPrice","priceCurrency","priceWeightUnit","commissionPerMaund","currency",
  "traderName","lockedAt","lockedBy","deliveryStart","deliveryEnd","updatedAt"
) SELECT
  ${sqlStr(`imp_ec_${newRef.replace(/-/g, "_").toLowerCase()}`)},
  ${sqlStr(newRef)}, t.id,
  t."tradeDate", 'SELL', 'SALE_EX_WAREHOUSE', 'LOCAL', 'Ex-Warehouse',
  'CORN', ${sqlStr(row.commodity)}, cp.name, cp.code, cp.ntn,
  'MT', ${row.finalQty}, ${row.executed}, ${row.open},
  ${sqlStr(contractStatus)}, 10,
  '{"damagePct":0,"brokenPct":0,"fungusPct":0,"foreignMatterPct":0,"moisturePct":10}'::jsonb,
  ${row.netRate}, ${rateKg}, ${row.rateMd}, 'PKR', 'MAUND',
  ${Math.max(0, row.netRate - row.rateMd)}, 'PKR',
  ${CORN_TRADER_NAME_SQL}, t."lockedAt", 'corn-excel-import',
  t."deliveryStart", t."deliveryEnd", NOW()
FROM "Trade" t
JOIN "Counterparty" cp ON cp.id = t."counterpartyId"
WHERE t."tradeRef" = ${sqlStr(newRef)}
  AND NOT EXISTS (SELECT 1 FROM "ExecutionContract" WHERE "tradeRef" = ${sqlStr(newRef)});\n`);
    } else if (existingRef) {
      console.log(`-- Sync existing ${tradeRef} ← ${row.contractNo}`);
      console.log(`UPDATE "Trade" SET
  "contractRef" = ${sqlStr(row.contractNo)},
  quantity = ${row.finalQty > 0 ? row.finalQty : "quantity"},
  "ratePerMaund" = ${row.netRate},
  "ratePerKg" = ${rateKg},
  price = ${row.rateMd},
  "pricePerCanonicalQty" = ${rateKg * 1000},
  "tradeStatus" = ${sqlStr(tradeStatus)},
  "updatedAt" = NOW()
WHERE "tradeRef" = ${sqlStr(tradeRef)};\n`);
      console.log(`UPDATE "ExecutionContract" ec SET
  "contractualQtyMt" = ${row.finalQty},
  "receivedQtyMt" = ${row.executed},
  "openQtyMt" = ${row.open},
  "contractStatus" = ${sqlStr(contractStatus)},
  "ratePerMaund" = ${row.netRate},
  "ratePerKg" = ${rateKg},
  "unitPrice" = ${row.rateMd},
  "updatedAt" = NOW()
FROM "Trade" t
WHERE ec."tradeRef" = t."tradeRef" AND t."tradeRef" = ${sqlStr(tradeRef)};\n`);
    }
  }

  // Outbound dispatches for imported + synced sale contracts (not SAL-0001/0002).
  const outboundTradeRef: Record<string, string> = { ...NEW_TRADE_REFS, ...EXISTING };
  delete outboundTradeRef["KAS-COR27-SAL-0001"];
  delete outboundTradeRef["KAS-COR27-SAL-0002"];
  let seq = 1;
  for (const o of outbound) {
    const tradeRef = outboundTradeRef[o.contractNo];
    if (!tradeRef) continue;
    if (!COMPANY_WAREHOUSES.has(o.warehouse)) {
      console.log(`-- Skip outbound ${o.contractNo}: warehouse ${sqlStr(o.warehouse)} is not a company warehouse`);
      continue;
    }
    const mt = o.weightKg / 1000;
    const rateKg = o.rateMd / 40;
    const amount = o.amount > 0 ? o.amount : mt * rateKg * 1000;
    const id = `imp_ob_${String(seq).padStart(5, "0")}`;
    seq += 1;
    console.log(`INSERT INTO "OutboundDispatch" (
  "id","tradeRef","dispatchDate","liftedBy","buyerName","warehouseName","truckNo",
  "dispatchWeightKg","invoiceWeightKg","allocatedQtyMt","amountDue","status","remarks","updatedAt"
) SELECT
  ${sqlStr(id)}, ${sqlStr(tradeRef)},
  ${sqlStr(fmtTs(o.dispatchDate))}::timestamp,
  ${sqlStr(o.buyer)}, ${sqlStr(o.buyer)}, ${sqlStr(o.warehouse)}, ${sqlStr(o.truckNo)},
  ${o.weightKg}, ${o.weightKg}, ${mt}, ${amount}, 'RELEASED',
  ${sqlStr(`Excel import · ${o.contractNo}`)}, NOW()
WHERE EXISTS (SELECT 1 FROM "Trade" WHERE "tradeRef" = ${sqlStr(tradeRef)})
  AND NOT EXISTS (
    SELECT 1 FROM "OutboundDispatch"
    WHERE "tradeRef" = ${sqlStr(tradeRef)}
      AND "truckNo" = ${sqlStr(o.truckNo)}
      AND "dispatchDate" = ${sqlStr(fmtTs(o.dispatchDate))}::timestamp
      AND "dispatchWeightKg" = ${o.weightKg}
  );`);
  }

  console.log("\n-- Bump trade ref counter past KAS-2026-81");
  console.log(`INSERT INTO "RefCounter" ("name","value") VALUES ('trade', 81)
ON CONFLICT ("name") DO UPDATE SET "value" = GREATEST("RefCounter"."value", 81);\n`);
  console.log("COMMIT;");
}

main();
