/**
 * Import missing Corn Summer 26 **sale contracts** from the Execution workbook.
 *
 *   npx tsx scripts/import-missing-sales-from-execution-excel.ts
 *   npx tsx scripts/import-missing-sales-from-execution-excel.ts --apply
 *
 * Env:
 *   CORN_EXECUTION_XLSX — defaults to Corn Summer 26 Execution (1).xlsx in Downloads
 *   POSTGRES_PRISMA_URL — required for --apply (or DATABASE_URL copied in load-env)
 */
import "./load-env";
process.env.MOCK_MODE = "false";
if (!process.env.POSTGRES_PRISMA_URL && process.env.DATABASE_URL) {
  process.env.POSTGRES_PRISMA_URL = process.env.DATABASE_URL;
}

import * as fs from "node:fs";
import XLSX from "xlsx";
import {
  PaymentType,
  TradeDirection,
  TradeStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/server/db";
import { KG_PER_MAUND } from "@/lib/trade-constants";
import { closeLockedContract } from "@/server/execution/contracts";
import { mockBookTrade } from "@/server/dummy-data";
import { lockTradeInStore } from "@/server/execution/contracts";
import { getSystemUserId } from "@/server/db/system-user";
import { CORN_TRADER_EMAIL } from "./lib/corn-trader";

const EXECUTION_XLSX =
  process.env.CORN_EXECUTION_XLSX ??
  "C:/Users/HP/Downloads/Corn Summer 26 Execution (1).xlsx";
const APPLY = process.argv.includes("--apply");
const ACTOR = "corn-excel-import";

/** Excel contract → existing system tradeRef (when already booked). */
const EXISTING_REF: Record<string, string> = {
  "KAS-COR27-SAL-0001": "KAS-2026-73",
  "KAS-COR27-SAL-0002": "KAS-2026-75",
};

const WH_MAP: Record<string, string> = {
  gama: "Gamma Warehouse",
  gamma: "Gamma Warehouse",
  fareeq: "Faqir Warehouse",
  faqir: "Faqir Warehouse",
  fakeer: "Faqir Warehouse",
  faqeer: "Faqir Warehouse",
  umer: "Umar Warehouse",
  umar: "Umar Warehouse",
};

const COMPANY_WAREHOUSES = new Set([
  "Faqir Warehouse",
  "Gamma Warehouse",
  "Umar Warehouse",
]);

type SaleContractRow = {
  contractNo: string;
  tradeDate: Date;
  buyer: string;
  cpId: string | null;
  ntn: string | null;
  commodity: string;
  finalQtyMt: number;
  rateMd: number;
  netRateMd: number;
  executedQtyMt: number;
  openQtyMt: number;
  status: string;
  deliveryEnd: Date | null;
  season: "SUMMER" | "WINTER";
};

type OutboundRow = {
  contractNo: string;
  dispatchDate: Date;
  buyer: string;
  cpId: string | null;
  warehouse: string;
  truckNo: string;
  weightKg: number;
  rateMd: number;
  amount: number;
};

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string => (v == null ? "" : String(v).trim());

function excelDateToJs(v: unknown): Date | null {
  if (v instanceof Date) return v;
  const n = num(v);
  if (n == null) return null;
  return new Date(Date.UTC(1899, 11, 30) + n * 86400000);
}

function normWarehouse(raw: string): string {
  const key = raw.trim().toLowerCase();
  return WH_MAP[key] ?? raw.trim();
}

function parseSaleContracts(filePath: string): SaleContractRow[] {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets["Sale Contract"];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
  const out: SaleContractRow[] = [];
  for (const r of rows) {
    const contractNo = str(r[2]);
    if (!contractNo.toUpperCase().startsWith("KAS-COR")) continue;
    const tradeDate = excelDateToJs(r[1]);
    if (!tradeDate) continue;
    const commodity = str(r[7]);
    const finalQty = num(r[10]) ?? num(r[9]) ?? 0;
    const rateMd = num(r[11]) ?? 0;
    const netRate = num(r[14]) ?? rateMd;
    out.push({
      contractNo,
      tradeDate,
      buyer: str(r[3]),
      cpId: str(r[4]) || null,
      ntn: str(r[5]) || null,
      commodity,
      finalQtyMt: finalQty,
      rateMd,
      netRateMd: netRate,
      executedQtyMt: num(r[15]) ?? 0,
      openQtyMt: num(r[16]) ?? 0,
      status: str(r[17]),
      deliveryEnd: excelDateToJs(r[19]),
      season: /winter/i.test(commodity) ? "WINTER" : "SUMMER",
    });
  }
  return out;
}

function parseOutbound(filePath: string): OutboundRow[] {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets["Outbound"];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
  const out: OutboundRow[] = [];
  for (const r of rows.slice(3)) {
    const contractNo = str(r[6]);
    if (!contractNo.toUpperCase().startsWith("KAS-COR")) continue;
    const dispatchDate = excelDateToJs(r[1]);
    const weightKg = num(r[12]) ?? num(r[14]) ?? 0;
    if (!dispatchDate || weightKg <= 0) continue;
    out.push({
      contractNo,
      dispatchDate,
      buyer: str(r[4]),
      cpId: str(r[3]) || null,
      warehouse: normWarehouse(str(r[9])),
      truckNo: str(r[11]) || "-",
      weightKg,
      rateMd: num(r[7]) ?? 0,
      amount: num(r[20]) ?? 0,
    });
  }
  return out;
}

async function resolveCounterparty(row: SaleContractRow) {
  if (row.cpId) {
    const byCode = await prisma.counterparty.findFirst({
      where: { code: row.cpId },
    });
    if (byCode) return byCode;
  }
  const byName = await prisma.counterparty.findFirst({
    where: { name: { equals: row.buyer, mode: "insensitive" } },
  });
  if (byName) return byName;
  const adminId = await getSystemUserId();
  return prisma.counterparty.create({
    data: {
      name: row.buyer,
      code: row.cpId ?? `CP-${Date.now()}`,
      ntn: row.ntn,
      type: "BUYER",
      side: "SELL",
      country: "Pakistan",
      kycStatus: "NOT_ON_FILE",
      createdById: adminId,
    },
  });
}

async function findTradeByContract(contractNo: string) {
  const mapped = EXISTING_REF[contractNo];
  if (mapped) {
    return prisma.trade.findUnique({ where: { tradeRef: mapped }, include: { contract: true } });
  }
  return prisma.trade.findFirst({
    where: { contractRef: contractNo },
    include: { contract: true },
  });
}

async function syncContractFulfillment(
  tradeRef: string,
  row: SaleContractRow,
): Promise<void> {
  const received = row.executedQtyMt;
  const open = row.openQtyMt;
  const closed = row.status.toLowerCase() === "closed" || open <= 0.001;
  await prisma.executionContract.update({
    where: { tradeRef },
    data: {
      receivedQtyMt: received,
      openQtyMt: open,
      contractStatus: closed ? "Close" : "Open",
      contractualQtyMt: row.finalQtyMt,
      ratePerMaund: row.netRateMd,
      ratePerKg: row.netRateMd / KG_PER_MAUND,
      unitPrice: row.rateMd,
    },
  });
  if (closed) {
    await prisma.trade.update({
      where: { tradeRef },
      data: { tradeStatus: TradeStatus.EXECUTED, contractRef: row.contractNo },
    });
  } else {
    await prisma.trade.update({
      where: { tradeRef },
      data: { tradeStatus: TradeStatus.LOCKED, contractRef: row.contractNo },
    });
  }
}

async function importOutboundForContract(
  tradeRef: string,
  contractNo: string,
  outbound: OutboundRow[],
  buyerName: string,
): Promise<number> {
  const rows = outbound.filter((o) => o.contractNo === contractNo);
  let created = 0;
  for (const o of rows) {
    if (!COMPANY_WAREHOUSES.has(o.warehouse)) {
      console.log(`  Skip outbound truck ${o.truckNo}: ${o.warehouse} is not a company warehouse`);
      continue;
    }
    const existing = await prisma.outboundDispatch.findFirst({
      where: {
        tradeRef,
        truckNo: o.truckNo,
        dispatchDate: o.dispatchDate,
        dispatchWeightKg: o.weightKg,
      },
    });
    if (existing) continue;
    const mt = o.weightKg / 1000;
    const rateKg = o.rateMd / KG_PER_MAUND;
    await prisma.outboundDispatch.create({
      data: {
        tradeRef,
        dispatchDate: o.dispatchDate,
        liftedBy: buyerName,
        buyerName,
        warehouseName: o.warehouse,
        truckNo: o.truckNo,
        dispatchWeightKg: o.weightKg,
        invoiceWeightKg: o.weightKg,
        allocatedQtyMt: mt,
        amountDue: o.amount > 0 ? o.amount : mt * rateKg * 1000,
        status: "RELEASED",
        remarks: `Imported from Execution Excel · ${contractNo}`,
      },
    });
    created += 1;
  }
  return created;
}

async function getCornTrader(): Promise<{ id: string; name: string; email: string }> {
  const user = await prisma.user.findFirst({
    where: { email: { equals: CORN_TRADER_EMAIL, mode: "insensitive" } },
    select: { id: true, name: true, email: true },
  });
  if (!user?.name || !user.email) {
    throw new Error(`Corn trader user not found or missing name: ${CORN_TRADER_EMAIL}`);
  }
  return { id: user.id, name: user.name, email: user.email };
}

async function createAndLockSale(row: SaleContractRow, commodityId: string): Promise<string> {
  const cornTrader = await getCornTrader();
  const traderName = cornTrader.name;
  const cp = await resolveCounterparty(row);
  const deliveryEnd = row.deliveryEnd ?? new Date(row.tradeDate.getTime() + 14 * 86400000);
  const ratePerKg = row.netRateMd / KG_PER_MAUND;

  const booked = await mockBookTrade({
    traderName,
    actorId: cornTrader.id,
    commodityId,
    commodityCode: "CORN",
    commodityName: row.season === "WINTER" ? "Corn - Winter" : "Corn",
    counterpartyId: cp.id,
    counterpartyName: cp.name,
    counterpartyCode: cp.code,
    direction: TradeDirection.SELL,
    quantity: row.finalQtyMt,
    quantityUnit: "MT",
    quantityEntered: row.finalQtyMt,
    quantityEnteredUnit: "MT",
    price: row.rateMd,
    currency: "PKR",
    priceCurrency: "PKR",
    priceWeightUnit: "MAUND",
    priceKgPerUnit: KG_PER_MAUND,
    ratePerMaund: row.netRateMd,
    commissionPerMaund: row.netRateMd - row.rateMd,
    priceBasis: "Fixed",
    tradeDate: row.tradeDate,
    deliveryStart: row.tradeDate,
    deliveryEnd,
    originName: "Punjab",
    destName: "",
    incoterms: "Ex-Warehouse",
    paymentType: PaymentType.ADVANCE_100,
    grade: "—",
    productOrigin: "Punjab",
    qualityTolerances: "Moisture within 10% Free",
    counterpartyKycStatus: cp.kycStatus,
    counterpartyKycRef: cp.kycRef,
    tradeScope: "LOCAL",
    season: row.season,
    submitToExecution: true,
    tradeParams: { quantityTolerance: "+/- 10%" },
    notes: `Imported from ${row.contractNo}`,
  });

  await prisma.trade.update({
    where: { tradeRef: booked.tradeRef },
    data: {
      contractRef: row.contractNo,
      warehouseSplitApproved: true,
      warehouseSplitApprovedAt: new Date(),
      warehouseSplitApprovedBy: ACTOR,
      tradeParams: {
        ...(typeof booked.tradeParams === "object" && booked.tradeParams ? booked.tradeParams : {}),
        quantityTolerance: "+/- 10%",
        executionWarehouseSplit: "Gamma Warehouse:0|Faqir Warehouse:0",
      } as Prisma.InputJsonValue,
    },
  });

  await lockTradeInStore(traderName, booked.tradeRef, {
    lockedBy: ACTOR,
    ratePerMaund: row.netRateMd,
    commissionPerMaund: Math.max(0, row.netRateMd - row.rateMd),
  });

  return booked.tradeRef;
}

async function main(): Promise<void> {
  if (!fs.existsSync(EXECUTION_XLSX)) {
    throw new Error(`Workbook not found: ${EXECUTION_XLSX}`);
  }

  const sales = parseSaleContracts(EXECUTION_XLSX);
  const outbound = parseOutbound(EXECUTION_XLSX);
  const corn = await prisma.commodity.findFirst({ where: { code: "CORN" } });
  if (!corn) throw new Error("CORN commodity not found in database");

  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`Sale contracts in Excel: ${sales.length}`);
  console.log(`Outbound rows in Excel: ${outbound.length}\n`);

  const plan: string[] = [];

  for (const row of sales) {
    const existing = await findTradeByContract(row.contractNo);
    if (existing) {
      plan.push(
        `SYNC ${row.contractNo} → ${existing.tradeRef} (${row.status}, exec ${row.executedQtyMt} MT, open ${row.openQtyMt} MT)`,
      );
      if (APPLY) {
        if (row.finalQtyMt > 0 && Number(existing.quantity) !== row.finalQtyMt) {
          await prisma.trade.update({
            where: { tradeRef: existing.tradeRef },
            data: { quantity: row.finalQtyMt },
          });
        }
        await syncContractFulfillment(existing.tradeRef, row);
        const ob = await importOutboundForContract(
          existing.tradeRef,
          row.contractNo,
          outbound,
          row.buyer,
        );
        console.log(`  synced ${existing.tradeRef}, +${ob} outbound dispatches`);
        if (row.status.toLowerCase() === "closed" && existing.contract?.contractStatus !== "Close") {
          await closeLockedContract(existing.tradeRef, ACTOR);
        }
      }
      continue;
    }

    if (row.finalQtyMt <= 0 && row.executedQtyMt <= 0) {
      plan.push(`SKIP ${row.contractNo} — cancelled / zero qty (${row.buyer})`);
      continue;
    }

    plan.push(
      `CREATE ${row.contractNo} — ${row.buyer}, ${row.finalQtyMt} MT @ ${row.netRateMd}, ${row.status}`,
    );
    if (APPLY) {
      const tradeRef = await createAndLockSale(row, corn.id);
      await syncContractFulfillment(tradeRef, row);
      const ob = await importOutboundForContract(tradeRef, row.contractNo, outbound, row.buyer);
      console.log(`  created ${tradeRef}, +${ob} outbound dispatches`);
      if (row.status.toLowerCase() === "closed") {
        await closeLockedContract(tradeRef, ACTOR);
      }
    }
  }

  console.log("\nPlan:");
  for (const line of plan) console.log(`  ${line}`);

  if (!APPLY) {
    console.log("\nRe-run with --apply to write (requires POSTGRES_PRISMA_URL).");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
