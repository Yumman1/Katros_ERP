import { prisma } from "@/server/db";
import { num, numOrNull } from "@/server/db/convert";
import { COUNTER, nextRef } from "@/server/db/counters";
import { traderNamesMatch } from "@/lib/trader-identity";
import { availableCreditPkr } from "@/server/finance/ledger";
import {
  TRUCK_INCLUDE,
  truckRowToRuntime,
  type PendingTruck,
  type SaleTruckStage,
} from "./runtime";
import { TraderInvoiceOwnershipError, truckTransporterName, truckTransporterPhone } from "./trucks";

/**
 * Outbound (sale) truck payment workflow.
 *
 * Assignment computes the receivable (weight × rate + 236G) and posts the
 * buyer-ledger DEBIT (see assignTruckToTrade). From there:
 *
 *   AWAITING_BALANCE ──send (needs ledger credit ≥ receivable)──▶ PENDING_TRADER
 *   PENDING_TRADER ──trader approves──▶ PENDING_FINANCE ──finance──▶ PAYMENT_RECEIVED
 *   AWAITING_BALANCE ──clear w/o payment──▶ CLEAR_PENDING_TRADER ──trader──▶
 *     CLEAR_PENDING_CEO ──CEO──▶ CLEARED_UNPAID
 *
 * PAYMENT_RECEIVED / CLEARED_UNPAID issue the Gate Out Slip + Delivery Order
 * numbers; execution prints them and flips the manual release toggle
 * (markSaleTruckReleased) — only then does the register show RELEASED.
 */

// ─── Shared helpers ──────────────────────────────────────────────────────────

async function saleTruckOrThrow(truckId: string) {
  const row = await prisma.pendingTruck.findUnique({ where: { id: truckId } });
  if (!row) throw new Error("Gate entry not found");
  if (row.movementType !== "OUTBOUND") {
    throw new Error("Sale payment workflow applies to outbound trucks only");
  }
  return row;
}

/** SELL-side counterparty of the truck's assigned sale trade. */
async function saleCounterparty(truckId: string, assignedTradeRef: string | null) {
  const entry = await prisma.counterpartyLedgerEntry.findUnique({
    where: { truckId },
    select: { counterpartyId: true },
  });
  let counterpartyId = entry?.counterpartyId ?? null;
  if (!counterpartyId && assignedTradeRef) {
    const trade = await prisma.trade.findUnique({
      where: { tradeRef: assignedTradeRef },
      select: { counterpartyId: true },
    });
    counterpartyId = trade?.counterpartyId ?? null;
  }
  if (!counterpartyId) {
    throw new Error("Assign the truck to a sale trade first — no buyer ledger to check");
  }
  const cp = await prisma.counterparty.findUnique({
    where: { id: counterpartyId },
    select: { id: true, name: true, code: true },
  });
  if (!cp) throw new Error("Buyer counterparty not found");
  return cp;
}

async function freshTruck(truckId: string): Promise<PendingTruck> {
  const row = await prisma.pendingTruck.findUnique({
    where: { id: truckId },
    include: TRUCK_INCLUDE,
  });
  return truckRowToRuntime(row!);
}

/** Guarded stage transition — fails if someone else moved the truck meanwhile. */
async function transition(
  truckId: string,
  from: SaleTruckStage[],
  to: SaleTruckStage,
  extra?: Record<string, unknown>,
): Promise<void> {
  const updated = await prisma.pendingTruck.updateMany({
    where: { id: truckId, movementType: "OUTBOUND", saleStage: { in: from } },
    data: { saleStage: to, ...(extra ?? {}) },
  });
  if (updated.count === 0) {
    throw new Error("Truck stage changed in the meantime — refresh and try again");
  }
}

/**
 * Issue Gate Out Slip + Delivery Order numbers. This does NOT release the
 * truck — execution prints the documents and, once they are handed to the
 * warehouse manager, flips the manual release toggle (markSaleTruckReleased).
 */
async function issueReleaseDocuments(truckId: string): Promise<void> {
  const row = await prisma.pendingTruck.findUnique({
    where: { id: truckId },
    select: { gateOutSlipNo: true, deliveryOrderNo: true },
  });
  if (!row) return;
  const gateOutSlipNo =
    row.gateOutSlipNo ?? `GOS-${String(await nextRef(COUNTER.GATE_OUT_SLIP)).padStart(5, "0")}`;
  const deliveryOrderNo =
    row.deliveryOrderNo ?? `DO-${String(await nextRef(COUNTER.DELIVERY_ORDER)).padStart(5, "0")}`;
  await prisma.pendingTruck.update({
    where: { id: truckId },
    data: { gateOutSlipNo, deliveryOrderNo },
  });
}

/**
 * Manual release toggle (execution): confirms the printed Gate Out Slip +
 * Delivery Order were handed to the warehouse manager. Flips the gate
 * register dispatch to RELEASED and drops the truck from the workflow.
 */
export async function markSaleTruckReleased(
  truckId: string,
  releasedByName: string,
): Promise<PendingTruck> {
  const row = await saleTruckOrThrow(truckId);
  if (row.saleStage !== "PAYMENT_RECEIVED" && row.saleStage !== "CLEARED_UNPAID") {
    throw new Error("Only trucks with payment received (or CEO clearance) can be released");
  }
  if (!row.gateOutSlipNo || !row.deliveryOrderNo) {
    throw new Error("Release documents have not been issued yet");
  }
  if (row.saleReleasedAt) {
    throw new Error("This truck is already released");
  }
  await prisma.pendingTruck.update({
    where: { id: truckId },
    data: { saleReleasedAt: new Date(), saleReleasedBy: releasedByName },
  });
  await prisma.outboundDispatch.updateMany({
    where: { gatepassNo: row.gatepassNo },
    data: { status: "RELEASED" },
  });
  return freshTruck(truckId);
}

// ─── Execution: workflow rows + actions ──────────────────────────────────────

export type SaleWorkflowRow = {
  truckId: string;
  gatepassNo: string;
  truckNo: string;
  arrivalDate: Date;
  warehouseName: string;
  counterpartyName: string;
  commodityName: string | null;
  tradeRef: string | null;
  saleBasePkr: number | null;
  saleTaxPkr: number | null;
  saleExpectedPkr: number | null;
  saleStage: SaleTruckStage | null;
  /** Buyer's unconsumed approved credit (PKR); null until a trade is assigned. */
  availableCreditPkr: number | null;
  /** True when the buyer's credit covers this truck's receivable. */
  canSendForApproval: boolean;
  gateOutSlipNo: string | null;
  deliveryOrderNo: string | null;
  saleTraderApprovedBy: string | null;
  saleFinanceApprovedBy: string | null;
  saleCeoApprovedBy: string | null;
  /** Manual release toggle state (null = not yet handed to warehouse manager). */
  saleReleasedAt: Date | null;
  saleReleasedBy: string | null;
};

/** Outbound trucks in the sale payment workflow with per-buyer credit state. */
export async function getSaleWorkflowRows(): Promise<SaleWorkflowRow[]> {
  const rows = await prisma.pendingTruck.findMany({
    where: { movementType: "OUTBOUND", saleStage: { not: null } },
    orderBy: { arrivalDate: "asc" },
  });
  if (rows.length === 0) return [];

  const entries = await prisma.counterpartyLedgerEntry.findMany({
    where: { truckId: { in: rows.map((r) => r.id) } },
    select: { truckId: true, counterpartyId: true },
  });
  const cpByTruck = new Map(entries.map((e) => [e.truckId, e.counterpartyId]));
  const cpIds = [...new Set(entries.map((e) => e.counterpartyId))];
  const creditByCp = new Map<string, number>();
  for (const cpId of cpIds) {
    creditByCp.set(cpId, await availableCreditPkr(cpId));
  }

  return rows.map((r) => {
    const cpId = cpByTruck.get(r.id) ?? null;
    const available = cpId != null ? (creditByCp.get(cpId) ?? 0) : null;
    const expected = numOrNull(r.saleExpectedPkr);
    return {
      truckId: r.id,
      gatepassNo: r.gatepassNo,
      truckNo: r.truckNo,
      arrivalDate: r.arrivalDate,
      warehouseName: r.warehouseName,
      counterpartyName: r.counterpartyName,
      commodityName: r.commodityName,
      tradeRef: r.assignedTradeRef,
      saleBasePkr: numOrNull(r.saleBasePkr),
      saleTaxPkr: numOrNull(r.saleTaxPkr),
      saleExpectedPkr: expected,
      saleStage: r.saleStage,
      availableCreditPkr: available,
      canSendForApproval:
        r.saleStage === "AWAITING_BALANCE" &&
        expected != null &&
        available != null &&
        available >= expected,
      gateOutSlipNo: r.gateOutSlipNo,
      deliveryOrderNo: r.deliveryOrderNo,
      saleTraderApprovedBy: r.saleTraderApprovedBy,
      saleFinanceApprovedBy: r.saleFinanceApprovedBy,
      saleCeoApprovedBy: r.saleCeoApprovedBy,
      saleReleasedAt: r.saleReleasedAt,
      saleReleasedBy: r.saleReleasedBy,
    };
  });
}

/**
 * Send an outbound truck to the trade's trader for sell-invoice approval.
 * Blocked until the buyer's approved (finance-cleared) voucher credit covers
 * this truck's receivable — enter another voucher otherwise.
 */
export async function sendSaleTruckForApproval(truckId: string): Promise<PendingTruck> {
  const row = await saleTruckOrThrow(truckId);
  if (row.saleStage !== "AWAITING_BALANCE") {
    throw new Error("This truck is not awaiting balance — it is already in approval");
  }
  const expected = numOrNull(row.saleExpectedPkr);
  if (expected == null) throw new Error("Assign the truck to a sale trade first");
  const cp = await saleCounterparty(truckId, row.assignedTradeRef);
  const available = await availableCreditPkr(cp.id);
  if (available < expected) {
    throw new Error(
      `Insufficient ledger balance for ${cp.name}: available ${Math.round(available).toLocaleString("en-PK")} PKR ` +
        `< receivable ${Math.round(expected).toLocaleString("en-PK")} PKR. Enter a payment voucher first, ` +
        `or use “Clear without payment” (trader + CEO approval).`,
    );
  }
  await transition(truckId, ["AWAITING_BALANCE"], "PENDING_TRADER");
  return freshTruck(truckId);
}

/** Request release without full payment — goes to the trader, then the CEO. */
export async function requestClearWithoutPayment(truckId: string): Promise<PendingTruck> {
  const row = await saleTruckOrThrow(truckId);
  if (row.saleStage !== "AWAITING_BALANCE") {
    throw new Error("Only trucks awaiting balance can be sent for clearance without payment");
  }
  if (numOrNull(row.saleExpectedPkr) == null) {
    throw new Error("Assign the truck to a sale trade first");
  }
  await transition(truckId, ["AWAITING_BALANCE"], "CLEAR_PENDING_TRADER");
  return freshTruck(truckId);
}

// ─── Trader approvals ────────────────────────────────────────────────────────

export type TraderSaleApprovalRow = {
  truckId: string;
  gatepassNo: string;
  truckNo: string;
  arrivalDate: Date;
  warehouseName: string;
  tradeRef: string;
  counterpartyName: string;
  commodityName: string;
  saleBasePkr: number;
  saleTaxPkr: number;
  saleExpectedPkr: number;
  /** Buyer's ledger balance (credit − debit) for context. */
  buyerBalancePkr: number;
  stage: Extract<SaleTruckStage, "PENDING_TRADER" | "CLEAR_PENDING_TRADER">;
};

/** Sell-side approvals for this trader: payment approvals + clearance requests. */
export async function getTraderSaleApprovals(traderName: string): Promise<TraderSaleApprovalRow[]> {
  const rows = await prisma.pendingTruck.findMany({
    where: {
      movementType: "OUTBOUND",
      saleStage: { in: ["PENDING_TRADER", "CLEAR_PENDING_TRADER"] },
    },
    orderBy: { arrivalDate: "asc" },
  });
  const refs = [...new Set(rows.map((r) => r.assignedTradeRef).filter((x): x is string => !!x))];
  if (!refs.length) return [];
  const trades = await prisma.trade.findMany({
    where: { tradeRef: { in: refs } },
    select: {
      tradeRef: true,
      traderName: true,
      counterpartyId: true,
      counterparty: { select: { name: true } },
      commodity: { select: { name: true } },
    },
  });
  const tradeByRef = new Map(trades.map((t) => [t.tradeRef, t]));

  const balances = new Map<string, number>();
  async function balanceFor(cpId: string): Promise<number> {
    if (balances.has(cpId)) return balances.get(cpId)!;
    const [credit, debit] = await Promise.all([
      prisma.counterpartyLedgerEntry.aggregate({
        where: { counterpartyId: cpId, entryType: "CREDIT" },
        _sum: { amountPkr: true },
      }),
      prisma.counterpartyLedgerEntry.aggregate({
        where: { counterpartyId: cpId, entryType: "DEBIT" },
        _sum: { amountPkr: true },
      }),
    ]);
    const bal = (numOrNull(credit._sum.amountPkr) ?? 0) - (numOrNull(debit._sum.amountPkr) ?? 0);
    balances.set(cpId, bal);
    return bal;
  }

  const result: TraderSaleApprovalRow[] = [];
  for (const r of rows) {
    const trade = r.assignedTradeRef ? tradeByRef.get(r.assignedTradeRef) : undefined;
    if (!trade || !traderNamesMatch(trade.traderName, traderName)) continue;
    result.push({
      truckId: r.id,
      gatepassNo: r.gatepassNo,
      truckNo: r.truckNo,
      arrivalDate: r.arrivalDate,
      warehouseName: r.warehouseName,
      tradeRef: trade.tradeRef,
      counterpartyName: trade.counterparty.name,
      commodityName: trade.commodity.name,
      saleBasePkr: numOrNull(r.saleBasePkr) ?? 0,
      saleTaxPkr: numOrNull(r.saleTaxPkr) ?? 0,
      saleExpectedPkr: numOrNull(r.saleExpectedPkr) ?? 0,
      buyerBalancePkr: await balanceFor(trade.counterpartyId),
      stage: r.saleStage as TraderSaleApprovalRow["stage"],
    });
  }
  return result;
}

/**
 * Trader decision on a sell-side truck of one of their own trades.
 * PENDING_TRADER: APPROVE → PENDING_FINANCE, REJECT → AWAITING_BALANCE.
 * CLEAR_PENDING_TRADER: APPROVE → CLEAR_PENDING_CEO, REJECT → AWAITING_BALANCE.
 */
export async function traderResolveSaleTruck(
  traderName: string,
  truckId: string,
  decision: "APPROVE" | "REJECT",
): Promise<PendingTruck> {
  const row = await saleTruckOrThrow(truckId);
  if (row.saleStage !== "PENDING_TRADER" && row.saleStage !== "CLEAR_PENDING_TRADER") {
    throw new Error("This truck is not awaiting your approval");
  }
  const trade = row.assignedTradeRef
    ? await prisma.trade.findUnique({
        where: { tradeRef: row.assignedTradeRef },
        select: { traderName: true },
      })
    : null;
  if (!trade || !traderNamesMatch(trade.traderName, traderName)) {
    throw new TraderInvoiceOwnershipError("This truck is not linked to one of your trades");
  }

  if (decision === "REJECT") {
    await transition(truckId, ["PENDING_TRADER", "CLEAR_PENDING_TRADER"], "AWAITING_BALANCE");
    return freshTruck(truckId);
  }
  if (row.saleStage === "PENDING_TRADER") {
    await transition(truckId, ["PENDING_TRADER"], "PENDING_FINANCE", {
      saleTraderApprovedBy: traderName,
      saleTraderApprovedAt: new Date(),
    });
  } else {
    await transition(truckId, ["CLEAR_PENDING_TRADER"], "CLEAR_PENDING_CEO", {
      saleTraderApprovedBy: traderName,
      saleTraderApprovedAt: new Date(),
    });
  }
  return freshTruck(truckId);
}

// ─── Finance approvals ───────────────────────────────────────────────────────

export type FinanceSaleApprovalRow = Omit<TraderSaleApprovalRow, "stage"> & {
  traderName: string;
  saleTraderApprovedBy: string | null;
};

/** Sell invoices awaiting finance (trader already approved). */
export async function getFinanceSaleApprovals(): Promise<FinanceSaleApprovalRow[]> {
  const rows = await prisma.pendingTruck.findMany({
    where: { movementType: "OUTBOUND", saleStage: "PENDING_FINANCE" },
    orderBy: { arrivalDate: "asc" },
  });
  const refs = [...new Set(rows.map((r) => r.assignedTradeRef).filter((x): x is string => !!x))];
  const trades = refs.length
    ? await prisma.trade.findMany({
        where: { tradeRef: { in: refs } },
        select: {
          tradeRef: true,
          traderName: true,
          counterpartyId: true,
          counterparty: { select: { name: true } },
          commodity: { select: { name: true } },
        },
      })
    : [];
  const tradeByRef = new Map(trades.map((t) => [t.tradeRef, t]));

  const result: FinanceSaleApprovalRow[] = [];
  for (const r of rows) {
    const trade = r.assignedTradeRef ? tradeByRef.get(r.assignedTradeRef) : undefined;
    if (!trade) continue;
    const [credit, debit] = await Promise.all([
      prisma.counterpartyLedgerEntry.aggregate({
        where: { counterpartyId: trade.counterpartyId, entryType: "CREDIT" },
        _sum: { amountPkr: true },
      }),
      prisma.counterpartyLedgerEntry.aggregate({
        where: { counterpartyId: trade.counterpartyId, entryType: "DEBIT" },
        _sum: { amountPkr: true },
      }),
    ]);
    result.push({
      truckId: r.id,
      gatepassNo: r.gatepassNo,
      truckNo: r.truckNo,
      arrivalDate: r.arrivalDate,
      warehouseName: r.warehouseName,
      tradeRef: trade.tradeRef,
      counterpartyName: trade.counterparty.name,
      commodityName: trade.commodity.name,
      saleBasePkr: numOrNull(r.saleBasePkr) ?? 0,
      saleTaxPkr: numOrNull(r.saleTaxPkr) ?? 0,
      saleExpectedPkr: numOrNull(r.saleExpectedPkr) ?? 0,
      buyerBalancePkr:
        (numOrNull(credit._sum.amountPkr) ?? 0) - (numOrNull(debit._sum.amountPkr) ?? 0),
      traderName: trade.traderName,
      saleTraderApprovedBy: r.saleTraderApprovedBy,
    });
  }
  return result;
}

/** Finance decision: APPROVE → PAYMENT_RECEIVED (+ release), REJECT → AWAITING_BALANCE. */
export async function financeResolveSaleTruck(
  truckId: string,
  financeName: string,
  decision: "APPROVE" | "REJECT",
): Promise<PendingTruck> {
  const row = await saleTruckOrThrow(truckId);
  if (row.saleStage !== "PENDING_FINANCE") {
    throw new Error("This truck is not awaiting finance approval");
  }
  if (decision === "REJECT") {
    await transition(truckId, ["PENDING_FINANCE"], "AWAITING_BALANCE");
    return freshTruck(truckId);
  }
  await transition(truckId, ["PENDING_FINANCE"], "PAYMENT_RECEIVED", {
    saleFinanceApprovedBy: financeName,
    saleFinanceApprovedAt: new Date(),
  });
  await issueReleaseDocuments(truckId);
  return freshTruck(truckId);
}

// ─── CEO clearance (release without payment) ─────────────────────────────────

export type CeoClearApprovalRow = FinanceSaleApprovalRow;

export async function getCeoClearApprovals(): Promise<CeoClearApprovalRow[]> {
  const rows = await prisma.pendingTruck.findMany({
    where: { movementType: "OUTBOUND", saleStage: "CLEAR_PENDING_CEO" },
    orderBy: { arrivalDate: "asc" },
  });
  const refs = [...new Set(rows.map((r) => r.assignedTradeRef).filter((x): x is string => !!x))];
  const trades = refs.length
    ? await prisma.trade.findMany({
        where: { tradeRef: { in: refs } },
        select: {
          tradeRef: true,
          traderName: true,
          counterpartyId: true,
          counterparty: { select: { name: true } },
          commodity: { select: { name: true } },
        },
      })
    : [];
  const tradeByRef = new Map(trades.map((t) => [t.tradeRef, t]));
  const result: CeoClearApprovalRow[] = [];
  for (const r of rows) {
    const trade = r.assignedTradeRef ? tradeByRef.get(r.assignedTradeRef) : undefined;
    if (!trade) continue;
    const [credit, debit] = await Promise.all([
      prisma.counterpartyLedgerEntry.aggregate({
        where: { counterpartyId: trade.counterpartyId, entryType: "CREDIT" },
        _sum: { amountPkr: true },
      }),
      prisma.counterpartyLedgerEntry.aggregate({
        where: { counterpartyId: trade.counterpartyId, entryType: "DEBIT" },
        _sum: { amountPkr: true },
      }),
    ]);
    result.push({
      truckId: r.id,
      gatepassNo: r.gatepassNo,
      truckNo: r.truckNo,
      arrivalDate: r.arrivalDate,
      warehouseName: r.warehouseName,
      tradeRef: trade.tradeRef,
      counterpartyName: trade.counterparty.name,
      commodityName: trade.commodity.name,
      saleBasePkr: numOrNull(r.saleBasePkr) ?? 0,
      saleTaxPkr: numOrNull(r.saleTaxPkr) ?? 0,
      saleExpectedPkr: numOrNull(r.saleExpectedPkr) ?? 0,
      buyerBalancePkr:
        (numOrNull(credit._sum.amountPkr) ?? 0) - (numOrNull(debit._sum.amountPkr) ?? 0),
      traderName: trade.traderName,
      saleTraderApprovedBy: r.saleTraderApprovedBy,
    });
  }
  return result;
}

/** CEO decision on a clear-without-payment request. */
export async function ceoResolveClearWithoutPayment(
  truckId: string,
  ceoName: string,
  decision: "APPROVE" | "REJECT",
): Promise<PendingTruck> {
  const row = await saleTruckOrThrow(truckId);
  if (row.saleStage !== "CLEAR_PENDING_CEO") {
    throw new Error("This truck is not awaiting CEO clearance");
  }
  if (decision === "REJECT") {
    await transition(truckId, ["CLEAR_PENDING_CEO"], "AWAITING_BALANCE");
    return freshTruck(truckId);
  }
  await transition(truckId, ["CLEAR_PENDING_CEO"], "CLEARED_UNPAID", {
    saleCeoApprovedBy: ceoName,
    saleCeoApprovedAt: new Date(),
  });
  await issueReleaseDocuments(truckId);
  return freshTruck(truckId);
}

// ─── Printables ──────────────────────────────────────────────────────────────

export type SaleTruckPrintable = {
  gatepassNo: string;
  gateOutSlipNo: string | null;
  deliveryOrderNo: string | null;
  issuedAt: Date | null;
  truckNo: string;
  transporterName: string | null;
  transporterPhone: string | null;
  builtyDetails: string | null;
  warehouseName: string;
  buyerName: string;
  commodityName: string | null;
  commodityCode: string | null;
  weightKg: number;
  tradeRef: string | null;
  saleBasePkr: number | null;
  saleTaxPkr: number | null;
  saleExpectedPkr: number | null;
  saleStage: SaleTruckStage | null;
  saleTraderApprovedBy: string | null;
  saleTraderApprovedAt: Date | null;
  saleFinanceApprovedBy: string | null;
  saleFinanceApprovedAt: Date | null;
  saleCeoApprovedBy: string | null;
  saleCeoApprovedAt: Date | null;
  saleReleasedAt: Date | null;
  saleReleasedBy: string | null;
  arrivalDate: Date;
  remarks: string | null;
};

/** Data bundle for the printable Gate Out Slip / Delivery Order. */
export async function getSaleTruckPrintable(truckId: string): Promise<SaleTruckPrintable> {
  const row = await prisma.pendingTruck.findUnique({
    where: { id: truckId },
    include: TRUCK_INCLUDE,
  });
  if (!row) throw new Error("Gate entry not found");
  const truck = truckRowToRuntime(row);
  return {
    gatepassNo: truck.gatepassNo,
    gateOutSlipNo: truck.gateOutSlipNo ?? null,
    deliveryOrderNo: truck.deliveryOrderNo ?? null,
    issuedAt: truck.saleFinanceApprovedAt ?? truck.saleCeoApprovedAt ?? null,
    truckNo: truck.truckNo,
    transporterName: truckTransporterName(truck),
    transporterPhone: truckTransporterPhone(truck),
    builtyDetails: truck.builtyDetails ?? null,
    warehouseName: truck.warehouseName,
    buyerName: truck.counterpartyName,
    commodityName: truck.commodityName ?? null,
    commodityCode: truck.commodityCode ?? null,
    weightKg: num(row.weightKg),
    tradeRef: truck.assignedTradeRef ?? null,
    saleBasePkr: truck.saleBasePkr ?? null,
    saleTaxPkr: truck.saleTaxPkr ?? null,
    saleExpectedPkr: truck.saleExpectedPkr ?? null,
    saleStage: truck.saleStage ?? null,
    saleTraderApprovedBy: truck.saleTraderApprovedBy ?? null,
    saleTraderApprovedAt: truck.saleTraderApprovedAt ?? null,
    saleFinanceApprovedBy: truck.saleFinanceApprovedBy ?? null,
    saleFinanceApprovedAt: truck.saleFinanceApprovedAt ?? null,
    saleCeoApprovedBy: truck.saleCeoApprovedBy ?? null,
    saleCeoApprovedAt: truck.saleCeoApprovedAt ?? null,
    saleReleasedAt: truck.saleReleasedAt ?? null,
    saleReleasedBy: truck.saleReleasedBy ?? null,
    arrivalDate: truck.arrivalDate,
    remarks: truck.remarks ?? null,
  };
}
