/**
 * Parse Corn Summer Excel workbooks for reconciliation report (Excel side only).
 *   npx tsx scripts/audit-excel-vs-db.ts
 */
import * as fs from "node:fs";
import XLSX from "xlsx";

const EXEC =
  process.env.CORN_EXECUTION_XLSX ??
  "C:/Users/HP/Downloads/Corn Summer 26 Execution (1).xlsx";
const PUR =
  process.env.CORN_PURCHASE_XLSX ??
  "C:/Users/HP/Downloads/Corn Summer - Purchase (2).xlsx";

const SAL_MAP: Record<string, string> = {
  "KAS-COR27-SAL-0001": "KAS-2026-73",
  "KAS-COR27-SAL-0002": "KAS-2026-75",
  "KAS-COR27-SAL-0003": "KAS-2026-76",
  "KAS-COR27-SAL-0004": "KAS-2026-78",
  "KAS-COR27-SAL-0005": "KAS-2026-79",
  "KAS-COR27-SAL-0006": "KAS-2026-80",
  "KAS-COR27-SAL-0007": "KAS-2026-81",
};

const WH_MAP: Record<string, string> = {
  gama: "Gamma Warehouse",
  gamma: "Gamma Warehouse",
  faqir: "Faqir Warehouse",
  faqeer: "Faqir Warehouse",
  fakeer: "Faqir Warehouse",
  fareeq: "Faqir Warehouse",
  umer: "Umar Warehouse",
  umar: "Umar Warehouse",
};

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
const str = (v: unknown) => (v == null ? "" : String(v).trim());
const excelDate = (v: unknown): string | null => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const n = num(v);
  if (n == null || n < 1 || n > 60000) return str(v) || null;
  const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

function normWh(raw: string): string {
  return WH_MAP[raw.trim().toLowerCase()] ?? raw.trim();
}

function main() {
  const execWb = XLSX.readFile(EXEC);
  const purWb = XLSX.readFile(PUR);

  const saleRows = XLSX.utils.sheet_to_json(execWb.Sheets["Sale Contract"], {
    header: 1,
    defval: "",
  }) as unknown[][];
  const sales = saleRows
    .filter((r) => str(r[2]).startsWith("KAS-COR"))
    .map((r) => ({
      contractNo: str(r[2]),
      tradeRef: SAL_MAP[str(r[2])] ?? str(r[2]),
      buyer: str(r[3]),
      qty: num(r[10]) ?? num(r[9]) ?? 0,
      executed: num(r[15]) ?? 0,
      open: num(r[16]) ?? 0,
      status: str(r[17]),
      rateMd: num(r[11]) ?? 0,
    }));

  const outRows = XLSX.utils.sheet_to_json(execWb.Sheets["Outbound"], {
    header: 1,
    defval: "",
  }) as unknown[][];
  const outbound = outRows
    .slice(3)
    .filter((r) => str(r[6]).startsWith("KAS-COR"))
    .map((r) => ({
      contractNo: str(r[6]),
      tradeRef: SAL_MAP[str(r[6])] ?? str(r[6]),
      date: excelDate(r[1]),
      truck: str(r[11]) || "-",
      warehouse: normWh(str(r[9])),
      kg: num(r[12]) ?? num(r[14]) ?? 0,
      mt: (num(r[12]) ?? num(r[14]) ?? 0) / 1000,
      amount: num(r[20]) ?? 0,
      countsForInventory: COMPANY_WAREHOUSES.has(normWh(str(r[9]))),
    }));

  const ledRows = XLSX.utils.sheet_to_json(execWb.Sheets["Ledger"], {
    header: 1,
    defval: "",
  }) as unknown[][];
  const ledger = ledRows.slice(1).flatMap((r, i) => {
    const cp = str(r[0]);
    const ref = str(r[1]);
    if (!cp && !ref) return [];
    return [
      {
        row: i + 2,
        counterparty: cp,
        ref,
        debit: num(r[2]),
        credit: num(r[3]),
        balance: num(r[4]),
        note: str(r[5]),
      },
    ];
  });

  const payRows = XLSX.utils.sheet_to_json(execWb.Sheets["Payments"], {
    header: 1,
    defval: "",
  }) as unknown[][];
  const payments = payRows.slice(1).flatMap((r) => {
    const ref = str(r[0]);
    if (!ref) return [];
    return [
      {
        ref,
        counterparty: str(r[1]),
        amount: num(r[2]),
        status: str(r[3]),
        date: excelDate(r[4]),
      },
    ];
  });

  const ptRows = XLSX.utils.sheet_to_json(purWb.Sheets["Purchase Trade"], {
    header: 1,
    defval: "",
  }) as unknown[][];
  const purchases = ptRows
    .slice(2)
    .filter((r) => str(r[0]).toLowerCase().startsWith("kas-cor"))
    .map((r) => ({
      ref: str(r[0]),
      cqty: num(r[2]),
      received: num(r[15]),
      open: num(r[16]),
      status: str(r[17]),
      rateMd: num(r[12]),
      seller: str(r[4]),
    }));

  const inRows = XLSX.utils.sheet_to_json(purWb.Sheets["Inbound Details"], {
    header: 1,
    defval: "",
  }) as unknown[][];
  const inbound = inRows
    .slice(3)
    .filter((r) => str(r[0]).startsWith("KCS-"))
    .map((r) => ({
      kcs: str(r[0]),
      date: excelDate(r[1]),
      truck: str(r[3]),
      warehouse: normWh(str(r[6])),
      trade: str(r[8]),
      status: str(r[10]),
      finalKg: num(r[22]),
      amount: num(r[23]),
    }));

  const outboundByContract = Object.fromEntries(
    [...new Set(outbound.map((o) => o.contractNo))].map((c) => [
      c,
      {
        trucks: outbound.filter((o) => o.contractNo === c).length,
        totalMt: outbound.filter((o) => o.contractNo === c).reduce((s, x) => s + x.mt, 0),
        inventoryMt: outbound
          .filter((o) => o.contractNo === c && o.countsForInventory)
          .reduce((s, x) => s + x.mt, 0),
        skippedMt: outbound
          .filter((o) => o.contractNo === c && !o.countsForInventory)
          .reduce((s, x) => s + x.mt, 0),
      },
    ]),
  );

  const out = {
    sales,
    outboundByContract,
    outboundTotal: outbound.length,
    purchases: { count: purchases.length, items: purchases },
    inbound: { count: inbound.length, kcsNos: inbound.map((i) => i.kcs) },
    ledger: { count: ledger.length, items: ledger },
    payments: { count: payments.length, items: payments },
  };

  fs.writeFileSync(
    "scripts/audit-excel-summary.json",
    JSON.stringify(out, null, 2),
  );
  console.log(JSON.stringify({
    sales: sales.length,
    outboundRows: outbound.length,
    purchases: purchases.length,
    inbound: inbound.length,
    ledger: ledger.length,
    payments: payments.length,
  }));
  console.log("\nSales:");
  for (const s of sales) {
    console.log(
      `  ${s.contractNo} → ${s.tradeRef}: exec=${s.executed} open=${s.open} status=${s.status}`,
    );
  }
  console.log("\nOutbound by contract:");
  console.log(JSON.stringify(outboundByContract, null, 2));
}

main();
