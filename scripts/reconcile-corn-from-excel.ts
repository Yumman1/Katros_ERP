/**
 * Reconcile Corn Summer trades against the latest Excel workbooks.
 *
 *   npx tsx scripts/reconcile-corn-from-excel.ts              # dry-run manifest
 *   npx tsx scripts/reconcile-corn-from-excel.ts --apply      # apply trade + payment fixes
 *   npx tsx scripts/reconcile-corn-from-excel.ts --report       # payment mismatches only
 */
import "./load-env";
import * as fs from "node:fs";
import * as path from "node:path";
import XLSX from "xlsx";
import { TradeStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import { num as dbNum } from "@/server/db/convert";
import { closeLockedContract } from "@/server/execution/contracts";
import { refreshContract } from "@/server/execution/contracts";
import {
  resolveInboundPayment,
  showsInTraderApprovals,
  type InboundExcelRow,
  type ResolvedInboundPayment,
} from "./lib/excel-inbound-payment";

const PURCHASE_XLSX =
  process.env.CORN_PURCHASE_XLSX ??
  "C:/Users/HP/Downloads/Corn Summer - Purchase (2).xlsx";
const EXECUTION_XLSX =
  process.env.CORN_EXECUTION_XLSX ??
  "C:/Users/HP/Downloads/Corn Summer 26 Execution (1).xlsx";
const APPLY = process.argv.includes("--apply");
const REPORT = process.argv.includes("--report");
const ACTOR = "corn-excel-sync";

type PaymentManifestItem = {
  kcsNo: string;
  gatepassNo: string | null;
  tradeRef: string;
  action:
    | "SYNC_PAYMENT_FULL"
    | "SYNC_PAYMENT_PARTIAL"
    | "SYNC_PAYMENT_HOLD"
    | "DELETE_PENDING_PR"
    | "LEDGER_MARK_PAID"
    | "OK";
  excelStatus: string;
  excelPaid: number;
  dbPaid: number;
  dbGateStage: string | null;
  dbReceiptStatus: string;
};

type PurchaseRow = {
  ref: string;
  cqty: number | null;
  received: number | null;
  open: number | null;
  status: string | null;
  rateMd: number | null;
  seller: string | null;
};

type InboundRow = {
  kcs: string;
  date: string | null;
  truck: string;
  warehouse: string;
  seller: string;
  trade: string;
  status: string;
  bags: number | null;
  spotKg: number | null;
  whKg: number | null;
  finalKg: number | null;
  amount: number | null;
  commission: number | null;
};

type SaleRow = {
  contractNo: string;
  buyer: string;
  cpId: string | null;
  ntn: string | null;
  qtyMt: number;
  rateMd: number;
  executedQty: number;
  openQty: number;
  status: string;
  tradeDate: Date | null;
  deliveryEnd: Date | null;
};

type ManifestItem = {
  tradeRef: string;
  field: string;
  excelValue: unknown;
  dbValue: unknown;
  action: string;
};

const WH_MAP: Record<string, string> = {
  gama: "Gamma Warehouse",
  gamma: "Gamma Warehouse",
  faqeer: "Faqir Warehouse",
  faqir: "Faqir Warehouse",
  fakeer: "Faqir Warehouse",
  umer: "Umar Warehouse",
  umar: "Umar Warehouse",
};

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const str = (v: unknown): string => (v == null ? "" : String(v).trim());

function parsePurchaseWorkbook(filePath: string): { trades: PurchaseRow[]; inbound: InboundRow[] } {
  const wb = XLSX.readFile(filePath);
  const ptWs = wb.Sheets["Purchase Trade"];
  const ptRows = XLSX.utils.sheet_to_json<unknown[]>(ptWs, { header: 1, defval: "" }) as unknown[][];
  const trades: PurchaseRow[] = [];
  for (const r of ptRows.slice(2)) {
    const ref = str(r[0]);
    if (!ref.toLowerCase().startsWith("kas-cor")) continue;
    trades.push({
      ref,
      cqty: num(r[2]),
      received: num(r[15]),
      open: num(r[16]),
      status: str(r[17]) || null,
      rateMd: num(r[12]),
      seller: str(r[4]) || null,
    });
  }

  const idWs = wb.Sheets["Inbound Details"];
  const idRows = XLSX.utils.sheet_to_json<unknown[]>(idWs, { header: 1, defval: "" }) as unknown[][];
  const inbound: InboundRow[] = [];
  for (const r of idRows.slice(3)) {
    const kcs = str(r[0]);
    if (!kcs.toUpperCase().startsWith("KCS-")) continue;
    const whRaw = str(r[6]);
    inbound.push({
      kcs,
      date: r[1] instanceof Date ? r[1].toISOString().slice(0, 10) : str(r[1]) || null,
      truck: str(r[3]),
      warehouse: WH_MAP[whRaw.toLowerCase()] ?? whRaw,
      seller: str(r[7]),
      trade: str(r[8]),
      status: str(r[10]),
      bags: num(r[11]),
      spotKg: num(r[12]),
      whKg: num(r[13]),
      finalKg: num(r[22]),
      amount: num(r[23]),
      commission: num(r[24]),
    });
  }
  return { trades, inbound };
}

function excelDateToJs(v: unknown): Date | null {
  if (v instanceof Date) return v;
  const n = num(v);
  if (n == null) return null;
  // Excel serial (46237 ≈ Aug 2026)
  const epoch = new Date(Date.UTC(1899, 11, 30));
  return new Date(epoch.getTime() + n * 86400000);
}

function parseExecutionWorkbook(filePath: string): SaleRow[] {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets["Sale Contract"];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" }) as unknown[][];
  const sales: SaleRow[] = [];
  for (const r of rows) {
    const contractNo = str(r[2]);
    if (!contractNo.toUpperCase().startsWith("KAS-COR")) continue;
    sales.push({
      contractNo,
      buyer: str(r[3]),
      cpId: str(r[4]) || null,
      ntn: str(r[5]) || null,
      qtyMt: num(r[10]) ?? num(r[8]) ?? 0,
      rateMd: num(r[11]) ?? 0,
      executedQty: num(r[14]) ?? 0,
      openQty: num(r[15]) ?? 0,
      status: str(r[16]),
      tradeDate: excelDateToJs(r[1]),
      deliveryEnd: excelDateToJs(r[19]),
    });
  }
  return sales;
}

const EXISTING_REF: Record<string, string> = {
  "KAS-COR27-SAL-0001": "KAS-2026-73",
  "KAS-COR27-SAL-0002": "KAS-2026-75",
  "KAS-COR27-SAL-0003": "KAS-2026-76",
  "KAS-COR27-SAL-0004": "KAS-2026-77",
  "KAS-COR27-SAL-0005": "KAS-2026-78",
  "KAS-COR27-SAL-0006": "KAS-2026-79",
  "KAS-COR27-SAL-0007": "KAS-2026-80",
};

/** @deprecated Use import-missing-sales-from-execution-excel.ts for new contracts. */
const SKIP_SALE_CONTRACTS = new Set<string>();

async function buildManifest(): Promise<{
  manifest: ManifestItem[];
  purchase: PurchaseRow[];
  inbound: InboundRow[];
  sales: SaleRow[];
}> {
  const { trades: purchase, inbound } = parsePurchaseWorkbook(PURCHASE_XLSX);
  const sales = parseExecutionWorkbook(EXECUTION_XLSX);
  const manifest: ManifestItem[] = [];

  const dbTrades = await prisma.trade.findMany({
    where: { tradeRef: { startsWith: "Kas-Cor26-" } },
  });
  const dbContracts = await prisma.executionContract.findMany({
    where: { tradeRef: { startsWith: "Kas-Cor26-" } },
  });
  const contractByRef = new Map(dbContracts.map((c) => [c.tradeRef, c]));
  const tradeByRef = new Map(dbTrades.map((t) => [t.tradeRef, t]));

  for (const xl of purchase) {
    const db = tradeByRef.get(xl.ref);
    if (!db) {
      manifest.push({ tradeRef: xl.ref, field: "exists", excelValue: true, dbValue: false, action: "MISSING" });
      continue;
    }
    const ec = contractByRef.get(xl.ref);
    if (xl.cqty != null && Math.abs(Number(db.quantity) - xl.cqty) > 0.001) {
      manifest.push({
        tradeRef: xl.ref,
        field: "contractualQtyMt",
        excelValue: xl.cqty,
        dbValue: Number(db.quantity),
        action: "UPDATE_QTY",
      });
    }
    if (ec && xl.status?.toLowerCase() === "close") {
      if (ec.contractStatus !== "Close") {
        manifest.push({
          tradeRef: xl.ref,
          field: "contractStatus",
          excelValue: "Close",
          dbValue: ec.contractStatus,
          action: "CLOSE_CONTRACT",
        });
      }
      if (db.tradeStatus !== TradeStatus.EXECUTED && db.tradeStatus !== TradeStatus.SETTLED) {
        manifest.push({
          tradeRef: xl.ref,
          field: "tradeStatus",
          excelValue: "EXECUTED",
          dbValue: db.tradeStatus,
          action: "CLOSE_TRADE",
        });
      }
    }
    if (ec && ec.contractStatus === "Close" && Number(ec.openQtyMt) > 0) {
      manifest.push({
        tradeRef: xl.ref,
        field: "openQtyMt",
        excelValue: 0,
        dbValue: Number(ec.openQtyMt),
        action: "ZERO_STALE_OPEN",
      });
    }
  }

  const dbInbound = await prisma.inboundReceipt.findMany({
    select: { kcsNo: true, tradeRef: true, allocatedQtyMt: true },
  });
  const dbKcs = new Set(dbInbound.map((r) => r.kcsNo));
  for (const row of inbound) {
    if (!dbKcs.has(row.kcs)) {
      manifest.push({
        tradeRef: row.trade,
        field: "inboundReceipt",
        excelValue: row.kcs,
        dbValue: null,
        action: "INSERT_INBOUND",
      });
    }
  }

  for (const xl of sales) {
    if (SKIP_SALE_CONTRACTS.has(xl.contractNo)) continue;
    const sysRef = EXISTING_REF[xl.contractNo] ?? xl.contractNo;
    const db = await prisma.trade.findUnique({
      where: { tradeRef: sysRef },
      include: { counterparty: true },
    });
    const ec = db
      ? await prisma.executionContract.findUnique({ where: { tradeRef: sysRef } })
      : null;
    if (!db) {
      manifest.push({
        tradeRef: sysRef,
        field: "exists",
        excelValue: xl.contractNo,
        dbValue: false,
        action: "CREATE_SALE",
      });
      continue;
    }
    if (xl.status.toLowerCase() === "closed" && ec?.contractStatus !== "Close") {
      manifest.push({
        tradeRef: sysRef,
        field: "contractStatus",
        excelValue: "Close",
        dbValue: ec?.contractStatus,
        action: "CLOSE_CONTRACT",
      });
    }
    if (xl.openQty === 0 && ec && Number(ec.openQtyMt) > 0) {
      manifest.push({
        tradeRef: sysRef,
        field: "openQtyMt",
        excelValue: 0,
        dbValue: Number(ec.openQtyMt),
        action: "CLOSE_CONTRACT",
      });
    }
    if (Math.abs(Number(db.ratePerMaund ?? 0) - xl.rateMd) > 0.01) {
      manifest.push({
        tradeRef: sysRef,
        field: "ratePerMaund",
        excelValue: xl.rateMd,
        dbValue: Number(db.ratePerMaund),
        action: "UPDATE_RATE",
      });
    }
    if (db.counterparty.name.toUpperCase() !== xl.buyer.toUpperCase()) {
      manifest.push({
        tradeRef: sysRef,
        field: "counterparty",
        excelValue: xl.buyer,
        dbValue: db.counterparty.name,
        action: "UPDATE_COUNTERPARTY",
      });
    }
  }

  const winterMt = await prisma.stockTransfer.aggregate({
    where: {
      commodityCode: "CORN",
      season: "WINTER",
      status: "RECEIVED",
      externalOrigin: { not: null },
    },
    _sum: { receivedQtyMt: true },
  });
  const winterTotal = Number(winterMt._sum.receivedQtyMt ?? 0);
  if (Math.abs(winterTotal - 105) > 0.01) {
    manifest.push({
      tradeRef: "WINTER_TRANSFERS",
      field: "receivedQtyMt",
      excelValue: 105,
      dbValue: winterTotal,
      action: "ADJUST_WINTER_TRANSFER",
    });
  }

  return { manifest, purchase, inbound, sales };
}

function inboundExcelRows(inbound: InboundRow[]): InboundExcelRow[] {
  return inbound.map((r) => ({
    kcs: r.kcs,
    trade: r.trade,
    status: r.status,
    amount: r.amount,
  }));
}

async function buildPaymentManifest(inbound: InboundRow[]): Promise<PaymentManifestItem[]> {
  const excelRows = inboundExcelRows(inbound);
  const dbReceipts = await prisma.inboundReceipt.findMany({
    select: {
      kcsNo: true,
      gatepassNo: true,
      tradeRef: true,
      amountDue: true,
      paidAmountPkr: true,
      status: true,
      paymentRequestId: true,
    },
  });
  const receiptByKcs = new Map(dbReceipts.map((r) => [r.kcsNo, r]));

  const dbTrucks = await prisma.pendingTruck.findMany({
    select: { gatepassNo: true, gateInvoiceStage: true },
  });
  const truckByGp = new Map(dbTrucks.map((t) => [t.gatepassNo, t]));

  const pendingPrByReceipt = new Map<string, string>();
  const pendingPrs = await prisma.paymentRequest.findMany({
    where: { sourceType: "INBOUND", status: "PENDING" },
    select: { id: true, requestRef: true, sourceId: true },
  });
  for (const pr of pendingPrs) pendingPrByReceipt.set(pr.sourceId, pr.requestRef);

  const items: PaymentManifestItem[] = [];

  for (const xl of excelRows) {
    const db = receiptByKcs.get(xl.kcs);
    if (!db) continue;

    const resolved = resolveInboundPayment(xl, excelRows);
    const truck = db.gatepassNo ? truckByGp.get(db.gatepassNo) : undefined;
    const dbPaid = dbNum(db.paidAmountPkr);
    const dbStage = truck?.gateInvoiceStage ?? null;
    const dbStatus = db.status;

    let action: PaymentManifestItem["action"] = "OK";

    if (resolved.class === "FULL_RELEASE") {
      const needsReceipt = dbStatus !== "PAID" || Math.abs(dbPaid - dbNum(db.amountDue)) > 0.01;
      const needsStage = dbStage !== "PAYMENT_APPROVED";
      if (needsReceipt || needsStage) action = "SYNC_PAYMENT_FULL";
    } else if (resolved.class === "PARTIAL_HOLD") {
      const needsPaid = Math.abs(dbPaid - resolved.paidAmountPkr) > 0.01;
      const needsStage = dbStage !== resolved.gateInvoiceStage;
      const needsStatus =
        resolved.receiptStatus === "PARTIALLY_PAID"
          ? dbStatus !== "PARTIALLY_PAID"
          : resolved.receiptStatus === "PAID"
            ? dbStatus !== "PAID"
            : dbStatus !== "ALLOCATED";
      if (needsPaid || needsStage || needsStatus) action = "SYNC_PAYMENT_PARTIAL";
    } else if (resolved.class === "FULL_HOLD") {
      if (dbStage !== "HOLD_OLD_DUES" || dbPaid > 0.005 || dbStatus === "PAID") {
        action = "SYNC_PAYMENT_HOLD";
      }
    }

    if (
      db.paymentRequestId &&
      pendingPrByReceipt.has(db.paymentRequestId) &&
      resolved.class === "FULL_RELEASE"
    ) {
      action = action === "OK" ? "DELETE_PENDING_PR" : action;
    }

    if (action !== "OK" || resolved.class !== "NO_PAYMENT") {
      items.push({
        kcsNo: xl.kcs,
        gatepassNo: db.gatepassNo,
        tradeRef: db.tradeRef,
        action,
        excelStatus: xl.status,
        excelPaid: resolved.paidAmountPkr,
        dbPaid,
        dbGateStage: dbStage,
        dbReceiptStatus: dbStatus,
      });
    }
  }

  return items.filter((i) => i.action !== "OK");
}

async function markLedgerPaid(gatepassNo: string): Promise<void> {
  const pt = await prisma.pendingTruck.findFirst({
    where: { gatepassNo },
    select: { truckNo: true },
  });
  if (!pt) return;
  await prisma.counterpartyLedgerEntry.updateMany({
    where: { side: "BUY", sourceType: "GATEPASS", sourceRef: gatepassNo },
    data: { note: `Inbound ${gatepassNo} · ${pt.truckNo} — paid` },
  });
}

async function applyPaymentSync(resolved: ResolvedInboundPayment, receiptId: string, gatepassNo: string | null): Promise<void> {
  const receipt = await prisma.inboundReceipt.findUniqueOrThrow({
    where: { id: receiptId },
    select: { amountDue: true, paymentRequestId: true },
  });
  const amountDue = dbNum(receipt.amountDue);

  if (resolved.class === "FULL_RELEASE") {
    if (receipt.paymentRequestId) {
      await prisma.paymentRequest.updateMany({
        where: { id: receipt.paymentRequestId, status: "PENDING" },
        data: { status: "APPROVED", approvedBy: ACTOR, approvedAt: new Date() },
      });
    }
    await prisma.inboundReceipt.update({
      where: { id: receiptId },
      data: {
        paidAmountPkr: amountDue,
        status: "PAID",
        paymentRequestId: null,
      },
    });
    if (gatepassNo) {
      await prisma.pendingTruck.updateMany({
        where: { gatepassNo },
        data: { gateInvoiceStage: "PAYMENT_APPROVED", gateInvoiceHoldNote: null },
      });
      await markLedgerPaid(gatepassNo);
    }
    return;
  }

  if (resolved.class === "PARTIAL_HOLD" && gatepassNo) {
    await prisma.inboundReceipt.update({
      where: { id: receiptId },
      data: {
        paidAmountPkr: resolved.paidAmountPkr,
        status: resolved.receiptStatus,
      },
    });
    await prisma.pendingTruck.updateMany({
      where: { gatepassNo },
      data: {
        gateInvoiceStage: resolved.gateInvoiceStage,
        gateInvoiceHoldNote: resolved.holdNote,
      },
    });
    return;
  }

  if (resolved.class === "FULL_HOLD" && gatepassNo) {
    if (receipt.paymentRequestId) {
      await prisma.paymentRequest.updateMany({
        where: { id: receipt.paymentRequestId, status: "PENDING" },
        data: { status: "APPROVED", approvedBy: ACTOR, approvedAt: new Date() },
      });
    }
    await prisma.inboundReceipt.update({
      where: { id: receiptId },
      data: { paidAmountPkr: 0, status: "ALLOCATED", paymentRequestId: null },
    });
    await prisma.pendingTruck.updateMany({
      where: { gatepassNo },
      data: { gateInvoiceStage: "HOLD_OLD_DUES", gateInvoiceHoldNote: resolved.holdNote },
    });
  }
}

async function applyPaymentManifest(inbound: InboundRow[], items: PaymentManifestItem[]): Promise<void> {
  const excelRows = inboundExcelRows(inbound);
  const byKcs = new Map(items.map((i) => [i.kcsNo, i]));

  for (const xl of excelRows) {
    const item = byKcs.get(xl.kcs);
    if (!item || item.action === "OK") continue;

    const receipt = await prisma.inboundReceipt.findFirst({ where: { kcsNo: xl.kcs } });
    if (!receipt) continue;

    const resolved = resolveInboundPayment(xl, excelRows);
    console.log(
      `[${item.action}] ${xl.kcs} ${item.gatepassNo ?? "—"} excel="${xl.status}" paid ${item.dbPaid} → ${resolved.paidAmountPkr}`,
    );
    await applyPaymentSync(resolved, receipt.id, receipt.gatepassNo);
  }
}

async function printPaymentReport(inbound: InboundRow[]): Promise<void> {
  const mismatches = await buildPaymentManifest(inbound);
  const approvalRows = await prisma.pendingTruck.findMany({
    where: {
      gateInvoiceNo: { not: null },
      gateInvoiceStage: { in: ["PENDING_TRADE_APPROVAL", "HOLD_OLD_DUES", "PARTIAL_PAYMENT"] },
    },
    select: { gatepassNo: true, gateInvoiceStage: true, gateInvoiceNo: true },
  });

  console.log(`\nPayment mismatches: ${mismatches.length}`);
  for (const m of mismatches) {
    console.log(
      `  [${m.action}] ${m.kcsNo} gp=${m.gatepassNo} stage=${m.dbGateStage} paid=${m.dbPaid} excelPaid=${m.excelPaid} "${m.excelStatus}"`,
    );
  }

  const inQueue = approvalRows.filter((r) => showsInTraderApprovals(r.gateInvoiceStage));
  console.log(`\nTrader approval queue (all traders): ${inQueue.length} trucks`);
  for (const r of inQueue) {
    console.log(`  ${r.gatepassNo} inv=${r.gateInvoiceNo} stage=${r.gateInvoiceStage}`);
  }
  console.log(
    `  Expected after sync: 4 PARTIAL_PAYMENT (inv 18 + 21), 0 PENDING_TRADE_APPROVAL`,
  );
}

async function ensureCounterparty(input: {
  name: string;
  code?: string | null;
  ntn?: string | null;
}): Promise<string> {
  const existing = await prisma.counterparty.findFirst({
    where: { name: { equals: input.name, mode: "insensitive" } },
  });
  if (existing) return existing.id;
  const admin = await prisma.user.findFirst({ select: { id: true } });
  const created = await prisma.counterparty.create({
    data: {
      name: input.name,
      code: input.code ?? `CP-${Date.now()}`,
      ntn: input.ntn ?? null,
      type: "BUYER",
      side: "SELL",
      country: "Pakistan",
      kycStatus: "NOT_ON_FILE",
      createdById: admin?.id ?? "cmryogcri0001127nixxg52ks",
    },
  });
  return created.id;
}

async function insertInboundFromExcel(row: InboundRow, allInbound: InboundRow[]): Promise<void> {
  const mt = (row.finalKg ?? row.whKg ?? 0) / 1000;
  const amountDue = row.amount ?? 0;
  const resolved = resolveInboundPayment(
    { kcs: row.kcs, trade: row.trade, status: row.status, amount: row.amount },
    inboundExcelRows(allInbound),
  );
  await prisma.inboundReceipt.create({
    data: {
      id: `sync_rc_${row.kcs.replace(/-/g, "_").toLowerCase()}`,
      kcsNo: row.kcs,
      tradeRef: row.trade,
      receiveDate: row.date ? new Date(row.date) : new Date(),
      truckNo: row.truck || "-",
      biltyNo: "-",
      trnNo: "-",
      warehouseName: row.warehouse,
      sellerName: row.seller,
      bags: row.bags != null ? Math.round(row.bags) : null,
      weightSpotKg: row.spotKg ?? row.finalKg ?? 0,
      weightWarehouseKg: row.whKg ?? row.finalKg ?? 0,
      weightDiffKg: 0,
      allocatedQtyMt: mt,
      amountDue,
      paidAmountPkr: resolved.paidAmountPkr,
      status: resolved.receiptStatus,
    },
  });
}

async function applyManifest(
  manifest: ManifestItem[],
  purchase: PurchaseRow[],
  inbound: InboundRow[],
  sales: SaleRow[],
): Promise<void> {
  const inboundByKcs = new Map(inbound.map((r) => [r.kcs, r]));
  const purchaseByRef = new Map(purchase.map((r) => [r.ref, r]));
  const salesByContract = new Map(sales.map((s) => [s.contractNo, s]));

  // 1. Missing inbound receipts (KCS-424 for 0067)
  for (const item of manifest.filter((m) => m.action === "INSERT_INBOUND")) {
    const kcs = String(item.excelValue);
    const row = inboundByKcs.get(kcs);
    if (!row) continue;
    console.log(`Insert inbound ${kcs} → ${row.trade} (${((row.finalKg ?? 0) / 1000).toFixed(3)} MT)`);
    await insertInboundFromExcel(row, inbound);
    await refreshContract(row.trade);
  }

  // 2. Contract qty fix (0066: 150 → 104)
  for (const item of manifest.filter((m) => m.action === "UPDATE_QTY")) {
    const qty = Number(item.excelValue);
    console.log(`Update ${item.tradeRef} quantity → ${qty} MT`);
    await prisma.trade.update({
      where: { tradeRef: item.tradeRef },
      data: { quantity: qty },
    });
    await prisma.executionContract.update({
      where: { tradeRef: item.tradeRef },
      data: { contractualQtyMt: qty },
    });
    await refreshContract(item.tradeRef);
  }

  // 3. Close purchase trades per Excel
  for (const xl of purchase.filter((p) => p.status?.toLowerCase() === "close")) {
    const db = await prisma.trade.findUnique({ where: { tradeRef: xl.ref } });
    const ec = db
      ? await prisma.executionContract.findUnique({ where: { tradeRef: xl.ref } })
      : null;
    if (!ec) continue;
    if (ec.contractStatus === "Close" && db?.tradeStatus === TradeStatus.EXECUTED) {
      if (Number(ec.openQtyMt) > 0) {
        await prisma.executionContract.update({
          where: { tradeRef: xl.ref },
          data: { openQtyMt: 0 },
        });
      }
      continue;
    }
    console.log(`Close purchase ${xl.ref}`);
    await closeLockedContract(xl.ref, ACTOR);
    await prisma.executionContract.update({
      where: { tradeRef: xl.ref },
      data: { openQtyMt: 0 },
    });
  }

  // 4. Zero stale openQty on already-closed contracts
  await prisma.executionContract.updateMany({
    where: { contractStatus: "Close", openQtyMt: { gt: 0 } },
    data: { openQtyMt: 0 },
  });

  // 5. Sales: close KAS-2026-73
  const sal1 = salesByContract.get("KAS-COR27-SAL-0001");
  if (sal1?.status.toLowerCase() === "closed") {
    console.log("Close sale KAS-2026-73 (SAL-0001)");
    await closeLockedContract("KAS-2026-73", ACTOR);
  }

  // 6. Sales: fix KAS-2026-75 counterparty + rate (SAL-0002)
  const sal2 = salesByContract.get("KAS-COR27-SAL-0002");
  if (sal2) {
    const cpId = await ensureCounterparty({
      name: sal2.buyer,
      code: sal2.cpId,
      ntn: sal2.ntn,
    });
    const cp = await prisma.counterparty.findUniqueOrThrow({ where: { id: cpId } });
    const ratePerKg = sal2.rateMd / 40;
    console.log(`Update KAS-2026-75 → ${cp.name}, rate ${sal2.rateMd}`);
    await prisma.trade.update({
      where: { tradeRef: "KAS-2026-75" },
      data: {
        counterpartyId: cpId,
        ratePerMaund: sal2.rateMd,
        ratePerKg,
        price: sal2.rateMd,
        pricePerCanonicalQty: ratePerKg * 1000,
        contractRef: "KAS-COR27-SAL-0002",
      },
    });
    await prisma.executionContract.update({
      where: { tradeRef: "KAS-2026-75" },
      data: {
        counterpartyName: cp.name,
        counterpartyCode: cp.code,
        counterpartyNtn: cp.ntn,
        ratePerMaund: sal2.rateMd,
        ratePerKg,
        unitPrice: sal2.rateMd,
      },
    });
  }

  // 7. Winter inventory: bump largest transfer to total 105 MT
  const winter = await prisma.stockTransfer.findMany({
    where: {
      commodityCode: "CORN",
      season: "WINTER",
      status: "RECEIVED",
      externalOrigin: { not: null },
    },
    orderBy: { receivedQtyMt: "desc" },
  });
  const total = winter.reduce((s, t) => s + Number(t.receivedQtyMt ?? t.dispatchedQtyMt), 0);
  const gap = 105 - total;
  if (Math.abs(gap) > 0.001 && winter[0]) {
    const cur = Number(winter[0].receivedQtyMt ?? winter[0].dispatchedQtyMt);
    const next = cur + gap;
    console.log(`Adjust ${winter[0].transferRef} winter qty ${cur} → ${next} MT (total 105)`);
    await prisma.stockTransfer.update({
      where: { transferRef: winter[0].transferRef },
      data: { receivedQtyMt: next, dispatchedQtyMt: next },
    });
  }

  // Refresh all touched purchase contracts
  for (const ref of ["Kas-Cor26-0066", "Kas-Cor26-0067"]) {
    await refreshContract(ref);
  }
}

async function printNetPosition(): Promise<void> {
  const { getSeasonNetPositions } = await import("@/server/net-position");
  const rows = await getSeasonNetPositions();
  for (const r of rows.filter((x) => x.commodityCode === "CORN")) {
    console.log(
      `${r.label}: openPurch=${r.openPurchasesMt} inv=${r.inventoryMt} openSales=${r.openSalesMt} net=${r.netPositionMt}`,
    );
  }
}

async function main(): Promise<void> {
  if (!fs.existsSync(PURCHASE_XLSX)) throw new Error(`Missing purchase workbook: ${PURCHASE_XLSX}`);
  if (!fs.existsSync(EXECUTION_XLSX)) throw new Error(`Missing execution workbook: ${EXECUTION_XLSX}`);

  const { trades: purchase, inbound } = parsePurchaseWorkbook(PURCHASE_XLSX);
  const sales = parseExecutionWorkbook(EXECUTION_XLSX);

  if (REPORT) {
    await printPaymentReport(inbound);
    return;
  }

  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  const { manifest } = await buildManifest();
  const paymentManifest = await buildPaymentManifest(inbound);

  const outPath = path.join(process.cwd(), "scripts", "corn-excel-sync-manifest.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), manifest, paymentManifest },
      null,
      2,
    ),
  );
  console.log(`Trade manifest: ${manifest.length} items → ${outPath}`);
  for (const m of manifest) {
    console.log(`  [${m.action}] ${m.tradeRef}.${m.field}: excel=${JSON.stringify(m.excelValue)} db=${JSON.stringify(m.dbValue)}`);
  }

  console.log(`Payment manifest: ${paymentManifest.length} mismatches`);
  for (const m of paymentManifest) {
    console.log(
      `  [${m.action}] ${m.kcsNo} gp=${m.gatepassNo} paid ${m.dbPaid}→${m.excelPaid} stage=${m.dbGateStage} "${m.excelStatus}"`,
    );
  }

  await printPaymentReport(inbound);

  if (APPLY) {
    await applyManifest(manifest, purchase, inbound, sales);
    if (paymentManifest.length) {
      console.log("\nApplying payment sync…");
      await applyPaymentManifest(inbound, paymentManifest);
    }
    console.log("\nAfter sync:");
    await printNetPosition();
    await printPaymentReport(inbound);
  } else {
    console.log("\nCurrent position:");
    await printNetPosition();
    console.log("\nRe-run with --apply to write changes.");
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
