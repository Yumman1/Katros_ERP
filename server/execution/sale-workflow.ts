import { prisma } from "@/server/db";
import { num, numOrNull } from "@/server/db/convert";
import { nextSerial, SERIALS } from "@/server/db/serials";
import { traderNamesMatch } from "@/lib/trader-identity";
import { agingBucketFor } from "@/lib/finance-policy";
import { availableCreditPkr, canFundTruck } from "@/server/finance/ledger";
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
 *   AWAITING_BALANCE ──(funding ok)──▶ Generate DO ──▶ DO_PENDING_EXECUTION
 *     ──head of execution──▶ DO_PENDING_FINANCE ──finance──▶ DO_APPROVED
 *     ──Generate gate pass──▶ GATE_PASS_ISSUED ──mark released──▶ dispatch RELEASED
 *
 *   AWAITING_BALANCE ──release on credit──▶ CLEAR_PENDING_TRADER ──trader──▶
 *     CLEAR_PENDING_CEO ──CEO──▶ CLEARED_UNPAID ──(same DO flow)──▶ …
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

/** Issue a Delivery Order number only — starts the DO approval chain. */
async function issueDeliveryOrderOnly(truckId: string): Promise<string> {
  const row = await prisma.pendingTruck.findUnique({
    where: { id: truckId },
    select: { deliveryOrderNo: true },
  });
  if (!row) throw new Error("Gate entry not found");
  const deliveryOrderNo = row.deliveryOrderNo ?? (await nextSerial(SERIALS.DELIVERY_ORDER));
  await prisma.pendingTruck.update({
    where: { id: truckId },
    data: { deliveryOrderNo },
  });
  return deliveryOrderNo;
}

/** Issue a Gate Out Slip number only — after both DO approvals. */
async function issueGateOutSlipOnly(truckId: string): Promise<string> {
  const row = await prisma.pendingTruck.findUnique({
    where: { id: truckId },
    select: { gateOutSlipNo: true },
  });
  if (!row) throw new Error("Gate entry not found");
  const gateOutSlipNo = row.gateOutSlipNo ?? (await nextSerial(SERIALS.GATE_OUT_SLIP));
  await prisma.pendingTruck.update({
    where: { id: truckId },
    data: { gateOutSlipNo },
  });
  return gateOutSlipNo;
}

/** @deprecated Legacy — issues both documents together for in-flight trucks. */
async function issueReleaseDocuments(truckId: string): Promise<void> {
  await issueDeliveryOrderOnly(truckId);
  await issueGateOutSlipOnly(truckId);
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
  const releasable: SaleTruckStage[] = [
    "GATE_PASS_ISSUED",
    "PAYMENT_RECEIVED",
    "CLEARED_UNPAID",
  ];
  if (!row.saleStage || !releasable.includes(row.saleStage)) {
    throw new Error("Generate the gate pass and complete DO approvals before releasing");
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
  /** Shared buyer voucher pool available (PKR); null until a trade is assigned. */
  availableCreditPkr: number | null;
  /** True when the buyer's voucher pool covers this truck. */
  canSendForApproval: boolean;
  /** CREDIT = payment due per trade terms; ADVANCE = vouchers required unless released on credit. */
  fundingKind: "CREDIT" | "ADVANCE" | null;
  /** For credit trades: payment due date from the truck ledger entry. */
  paymentDueDate: Date | null;
  fundingReason: string | null;
  gateOutSlipNo: string | null;
  deliveryOrderNo: string | null;
  saleTraderApprovedBy: string | null;
  saleFinanceApprovedBy: string | null;
  saleCeoApprovedBy: string | null;
  doExecutionApprovedBy: string | null;
  doFinanceApprovedBy: string | null;
  /** True when funding covers the truck or CEO cleared credit release. */
  canGenerateDo: boolean;
  /** True when both DO approvals are complete. */
  canGenerateGatePass: boolean;
  /** Manual release toggle state (null = not yet handed to warehouse manager). */
  saleReleasedAt: Date | null;
  saleReleasedBy: string | null;
  saleSettledAt: Date | null;
  saleSettledBy: string | null;
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
    select: { truckId: true, counterpartyId: true, dueDate: true },
  });
  const cpByTruck = new Map(entries.map((e) => [e.truckId, e.counterpartyId]));
  const dueDateByTruck = new Map(entries.map((e) => [e.truckId, e.dueDate]));

  // Per-truck funding check (trade credit line or vouchers) for the trucks
  // that are still awaiting balance.
  const fundingByTruck = new Map<
    string,
    Awaited<ReturnType<typeof canFundTruck>>
  >();
  for (const r of rows) {
    if (r.saleStage !== "AWAITING_BALANCE") continue;
    const cpId = cpByTruck.get(r.id);
    const expected = numOrNull(r.saleExpectedPkr);
    if (!cpId || !r.assignedTradeRef || expected == null) continue;
    fundingByTruck.set(
      r.id,
      await canFundTruck({
        counterpartyId: cpId,
        tradeRef: r.assignedTradeRef,
        amountPkr: expected,
        excludeTruckId: r.id,
      }),
    );
  }

  return rows.map((r) => {
    const expected = numOrNull(r.saleExpectedPkr);
    const funding = fundingByTruck.get(r.id) ?? null;
    const canGenerateDo =
      (r.saleStage === "AWAITING_BALANCE" && funding?.ok === true) ||
      r.saleStage === "CLEARED_UNPAID";
    const canGenerateGatePass = r.saleStage === "DO_APPROVED";
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
      availableCreditPkr: funding?.availablePkr ?? null,
      canSendForApproval: r.saleStage === "AWAITING_BALANCE" && funding?.ok === true,
      fundingKind: funding?.kind ?? null,
      paymentDueDate: dueDateByTruck.get(r.id) ?? null,
      fundingReason: funding?.reason ?? null,
      gateOutSlipNo: r.gateOutSlipNo,
      deliveryOrderNo: r.deliveryOrderNo,
      saleTraderApprovedBy: r.saleTraderApprovedBy,
      saleFinanceApprovedBy: r.saleFinanceApprovedBy,
      saleCeoApprovedBy: r.saleCeoApprovedBy,
      doExecutionApprovedBy: r.doExecutionApprovedBy,
      doFinanceApprovedBy: r.doFinanceApprovedBy,
      canGenerateDo,
      canGenerateGatePass,
      saleReleasedAt: r.saleReleasedAt,
      saleReleasedBy: r.saleReleasedBy,
      saleSettledAt: r.saleSettledAt,
      saleSettledBy: r.saleSettledBy,
    };
  });
}

/**
 * Generate a Delivery Order for an outbound truck — when voucher/credit funding
 * covers the receivable, or after CEO clearance on credit release.
 */
export async function generateDeliveryOrder(
  truckId: string,
  requestedByName: string,
): Promise<PendingTruck> {
  const row = await saleTruckOrThrow(truckId);
  if (row.saleStage === "AWAITING_BALANCE") {
    const expected = numOrNull(row.saleExpectedPkr);
    if (expected == null || !row.assignedTradeRef) {
      throw new Error("Assign the truck to a sale trade first");
    }
    const cp = await saleCounterparty(truckId, row.assignedTradeRef);
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Counterparty" WHERE "id" = ${cp.id} FOR UPDATE`;
      const funding = await canFundTruck(
        {
          counterpartyId: cp.id,
          tradeRef: row.assignedTradeRef!,
          amountPkr: expected,
          excludeTruckId: truckId,
        },
        tx,
      );
      if (!funding.ok) {
        throw new Error(
          `${funding.reason ?? "Insufficient funding"} — enter a payment voucher first, ` +
            `or request release on credit (trader + CEO approval).`,
        );
      }
      const updated = await tx.pendingTruck.updateMany({
        where: { id: truckId, movementType: "OUTBOUND", saleStage: "AWAITING_BALANCE" },
        data: {
          saleStage: "DO_PENDING_EXECUTION",
          saleFinanceApprovedBy: requestedByName,
          saleFinanceApprovedAt: new Date(),
        },
      });
      if (updated.count === 0) {
        throw new Error("Truck stage changed in the meantime — refresh and try again");
      }
    });
  } else if (row.saleStage === "CLEARED_UNPAID") {
    await transition(truckId, ["CLEARED_UNPAID"], "DO_PENDING_EXECUTION");
  } else {
    throw new Error("This truck is not ready for a delivery order");
  }
  await issueDeliveryOrderOnly(truckId);
  return freshTruck(truckId);
}

/** @deprecated Use generateDeliveryOrder — kept for existing clients. */
export async function confirmSalePayment(
  truckId: string,
  confirmedByName: string,
): Promise<PendingTruck> {
  return generateDeliveryOrder(truckId, confirmedByName);
}

/** Head of execution approves a pending delivery order. */
export async function approveDoExecution(
  truckId: string,
  approvedByName: string,
): Promise<PendingTruck> {
  await saleTruckOrThrow(truckId);
  await transition(truckId, ["DO_PENDING_EXECUTION"], "DO_PENDING_FINANCE", {
    doExecutionApprovedBy: approvedByName,
    doExecutionApprovedAt: new Date(),
  });
  return freshTruck(truckId);
}

/** Head of execution rejects a pending delivery order — truck returns to balance check. */
export async function rejectDoExecution(
  truckId: string,
  reason: string,
  rejectedByName: string,
): Promise<PendingTruck> {
  const row = await saleTruckOrThrow(truckId);
  if (row.saleStage !== "DO_PENDING_EXECUTION") {
    throw new Error("This delivery order is not awaiting execution approval");
  }
  const why = reason.trim();
  if (!why) throw new Error("A rejection reason is required");

  const deliveryOrderNo = row.deliveryOrderNo;
  await transition(truckId, ["DO_PENDING_EXECUTION"], "AWAITING_BALANCE", {
    deliveryOrderNo: null,
    doExecutionApprovedBy: null,
    doExecutionApprovedAt: null,
    doFinanceApprovedBy: null,
    doFinanceApprovedAt: null,
    saleFinanceApprovedBy: null,
    saleFinanceApprovedAt: null,
  });

  const { recordRejection } = await import("@/server/rejections");
  await recordRejection({
    kind: "DO_EXECUTION",
    refLabel: deliveryOrderNo ?? row.gatepassNo,
    gatepassNo: row.gatepassNo,
    tradeRef: row.assignedTradeRef,
    counterpartyName: row.counterpartyName,
    amountPkr: numOrNull(row.saleExpectedPkr),
    rejectedBy: rejectedByName,
    rejectedRole: "EXECUTION",
    reason: why,
  });
  return freshTruck(truckId);
}

/** Finance approves a delivery order after execution head approval. */
export async function approveDoFinance(
  truckId: string,
  approvedByName: string,
): Promise<PendingTruck> {
  await saleTruckOrThrow(truckId);
  await transition(truckId, ["DO_PENDING_FINANCE"], "DO_APPROVED", {
    doFinanceApprovedBy: approvedByName,
    doFinanceApprovedAt: new Date(),
  });
  return freshTruck(truckId);
}

/** Issue the gate out slip after both DO approvals. */
export async function generateGatePass(truckId: string): Promise<PendingTruck> {
  const row = await saleTruckOrThrow(truckId);
  if (row.saleStage !== "DO_APPROVED") {
    throw new Error("Delivery order must be approved by execution and finance first");
  }
  await issueGateOutSlipOnly(truckId);
  await transition(truckId, ["DO_APPROVED"], "GATE_PASS_ISSUED");
  return freshTruck(truckId);
}

export type DoApprovalRow = {
  truckId: string;
  gatepassNo: string;
  deliveryOrderNo: string | null;
  truckNo: string;
  arrivalDate: Date;
  warehouseName: string;
  counterpartyName: string;
  commodityName: string | null;
  tradeRef: string | null;
  saleExpectedPkr: number | null;
  weightKg: number;
};

export async function getDoExecutionApprovals(): Promise<DoApprovalRow[]> {
  const rows = await prisma.pendingTruck.findMany({
    where: { movementType: "OUTBOUND", saleStage: "DO_PENDING_EXECUTION" },
    orderBy: { arrivalDate: "asc" },
  });
  return rows.map((r) => ({
    truckId: r.id,
    gatepassNo: r.gatepassNo,
    deliveryOrderNo: r.deliveryOrderNo,
    truckNo: r.truckNo,
    arrivalDate: r.arrivalDate,
    warehouseName: r.warehouseName,
    counterpartyName: r.counterpartyName,
    commodityName: r.commodityName,
    tradeRef: r.assignedTradeRef,
    saleExpectedPkr: numOrNull(r.saleExpectedPkr),
    weightKg: num(r.weightKg),
  }));
}

export async function getDoFinanceApprovals(): Promise<DoApprovalRow[]> {
  const rows = await prisma.pendingTruck.findMany({
    where: { movementType: "OUTBOUND", saleStage: "DO_PENDING_FINANCE" },
    orderBy: { arrivalDate: "asc" },
  });
  return rows.map((r) => ({
    truckId: r.id,
    gatepassNo: r.gatepassNo,
    deliveryOrderNo: r.deliveryOrderNo,
    truckNo: r.truckNo,
    arrivalDate: r.arrivalDate,
    warehouseName: r.warehouseName,
    counterpartyName: r.counterpartyName,
    commodityName: r.commodityName,
    tradeRef: r.assignedTradeRef,
    saleExpectedPkr: numOrNull(r.saleExpectedPkr),
    weightKg: num(r.weightKg),
  }));
}

/**
 * Request release on credit (without full payment) — goes to the trade's
 * trader, then the CEO; the buyer's ledger goes negative on release.
 */
export async function requestClearWithoutPayment(truckId: string): Promise<PendingTruck> {
  const row = await saleTruckOrThrow(truckId);
  if (row.saleStage !== "AWAITING_BALANCE") {
    throw new Error("Only trucks awaiting balance can be sent for release on credit");
  }
  if (numOrNull(row.saleExpectedPkr) == null) {
    throw new Error("Assign the truck to a sale trade first");
  }
  await transition(truckId, ["AWAITING_BALANCE"], "CLEAR_PENDING_TRADER");
  return freshTruck(truckId);
}

/**
 * Settle a released-unpaid truck against the buyer's ledger credit (finance,
 * from the Counterparty Ledgers page). Consumes credit, stops the debit from
 * aging and clears the trader's payment reminder.
 */
export async function settleSaleTruck(
  truckId: string,
  settledByName: string,
): Promise<PendingTruck> {
  const row = await saleTruckOrThrow(truckId);
  if (row.saleStage !== "CLEARED_UNPAID") {
    throw new Error("Only released-unpaid trucks can be settled against old dues");
  }
  // Execution's release toggle comes first — settling earlier would strand
  // the truck in the workflow with no way to release it.
  if (!row.saleReleasedAt) {
    throw new Error(
      "Execution has not marked this truck released yet — settle only after the truck has left the gate",
    );
  }
  const expected = numOrNull(row.saleExpectedPkr);
  if (expected == null) throw new Error("This truck has no receivable recorded");
  if (!row.assignedTradeRef) throw new Error("This truck has no linked sale trade");
  const cp = await saleCounterparty(truckId, row.assignedTradeRef);

  // Same counterparty row lock as confirmSalePayment — settles and confirms
  // draw from the same voucher pool and must serialize.
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Counterparty" WHERE "id" = ${cp.id} FOR UPDATE`;
    const funding = await canFundTruck(
      { counterpartyId: cp.id, tradeRef: row.assignedTradeRef!, amountPkr: expected },
      tx,
    );
    if (!funding.ok) {
      throw new Error(funding.reason ?? "Insufficient vouchers to settle this truck");
    }
    const updated = await tx.pendingTruck.updateMany({
      where: { id: truckId, movementType: "OUTBOUND", saleStage: "CLEARED_UNPAID" },
      data: { saleStage: "SETTLED", saleSettledAt: new Date(), saleSettledBy: settledByName },
    });
    if (updated.count === 0) {
      throw new Error("Truck stage changed in the meantime — refresh and try again");
    }
  });
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
  /** Buyer's sell-ledger balance (credit − debit) for context. */
  buyerBalancePkr: number;
  stage: Extract<SaleTruckStage, "CLEAR_PENDING_TRADER">;
};

/** Release-on-credit requests awaiting this trader's approval. */
export async function getTraderSaleApprovals(traderName: string): Promise<TraderSaleApprovalRow[]> {
  const rows = await prisma.pendingTruck.findMany({
    where: {
      movementType: "OUTBOUND",
      saleStage: "CLEAR_PENDING_TRADER",
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
        where: { counterpartyId: cpId, side: "SELL", entryType: "CREDIT" },
        _sum: { amountPkr: true },
      }),
      prisma.counterpartyLedgerEntry.aggregate({
        where: { counterpartyId: cpId, side: "SELL", entryType: "DEBIT" },
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
 * Trader decision on a release-on-credit request for one of their trades.
 * APPROVE → CLEAR_PENDING_CEO; REJECT (reason required) → AWAITING_BALANCE
 * with a rejection record every dashboard can see.
 */
export async function traderResolveSaleTruck(
  traderName: string,
  truckId: string,
  decision: "APPROVE" | "REJECT",
  reason?: string,
): Promise<PendingTruck> {
  const row = await saleTruckOrThrow(truckId);
  if (row.saleStage !== "CLEAR_PENDING_TRADER") {
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
    const why = reason?.trim();
    if (!why) throw new Error("A rejection reason is required");
    await transition(truckId, ["CLEAR_PENDING_TRADER"], "AWAITING_BALANCE");
    const { recordRejection } = await import("@/server/rejections");
    await recordRejection({
      kind: "SELL_RELEASE_TRADER",
      refLabel: row.gatepassNo,
      gatepassNo: row.gatepassNo,
      tradeRef: row.assignedTradeRef,
      counterpartyName: row.counterpartyName,
      amountPkr: numOrNull(row.saleExpectedPkr),
      traderName,
      rejectedBy: traderName,
      rejectedRole: "TRADER",
      reason: why,
    });
    return freshTruck(truckId);
  }
  await transition(truckId, ["CLEAR_PENDING_TRADER"], "CLEAR_PENDING_CEO", {
    saleTraderApprovedBy: traderName,
    saleTraderApprovedAt: new Date(),
  });
  return freshTruck(truckId);
}

// ─── Trader payment reminders (released-on-credit trucks) ───────────────────

export type TraderUnpaidSellTruckRow = {
  truckId: string;
  gatepassNo: string;
  truckNo: string;
  warehouseName: string;
  tradeRef: string;
  counterpartyName: string;
  commodityName: string;
  saleExpectedPkr: number;
  releasedAt: Date | null;
  /** Payment due date (arrival + credit days); null = no credit terms. */
  dueDate: Date | null;
  /** Days LEFT until due (negative once overdue). */
  daysUntilDue: number | null;
  /** Days past due (0 while still current). */
  overdueDays: number;
  agingBucket: string;
};

/**
 * Standing reminders for the trader's Sell Invoices page: trucks released on
 * credit (CLEARED_UNPAID) whose payment has not been settled yet, with the
 * countdown to — or days past — their due date.
 */
export async function getTraderUnpaidSellTrucks(
  traderName: string,
): Promise<TraderUnpaidSellTruckRow[]> {
  const rows = await prisma.pendingTruck.findMany({
    where: { movementType: "OUTBOUND", saleStage: "CLEARED_UNPAID" },
    orderBy: { arrivalDate: "asc" },
  });
  if (!rows.length) return [];
  const refs = [...new Set(rows.map((r) => r.assignedTradeRef).filter((x): x is string => !!x))];
  const trades = await prisma.trade.findMany({
    where: { tradeRef: { in: refs } },
    select: {
      tradeRef: true,
      traderName: true,
      counterparty: { select: { name: true } },
      commodity: { select: { name: true } },
    },
  });
  const tradeByRef = new Map(trades.map((t) => [t.tradeRef, t]));
  const entries = await prisma.counterpartyLedgerEntry.findMany({
    where: { truckId: { in: rows.map((r) => r.id) } },
    select: { truckId: true, dueDate: true },
  });
  const dueByTruck = new Map(entries.map((e) => [e.truckId, e.dueDate]));

  const now = Date.now();
  const result: TraderUnpaidSellTruckRow[] = [];
  for (const r of rows) {
    const trade = r.assignedTradeRef ? tradeByRef.get(r.assignedTradeRef) : undefined;
    if (!trade || !traderNamesMatch(trade.traderName, traderName)) continue;
    const dueDate = dueByTruck.get(r.id) ?? null;
    const daysUntilDue =
      dueDate != null ? Math.ceil((dueDate.getTime() - now) / 86_400_000) : null;
    result.push({
      truckId: r.id,
      gatepassNo: r.gatepassNo,
      truckNo: r.truckNo,
      warehouseName: r.warehouseName,
      tradeRef: trade.tradeRef,
      counterpartyName: trade.counterparty.name,
      commodityName: trade.commodity.name,
      saleExpectedPkr: numOrNull(r.saleExpectedPkr) ?? 0,
      releasedAt: r.saleReleasedAt,
      dueDate,
      daysUntilDue,
      overdueDays: daysUntilDue != null && daysUntilDue < 0 ? -daysUntilDue : 0,
      agingBucket: agingBucketFor(dueDate),
    });
  }
  return result;
}

// ─── CEO clearance (release without payment) ─────────────────────────────────

export type CeoClearApprovalRow = Omit<TraderSaleApprovalRow, "stage"> & {
  traderName: string;
  saleTraderApprovedBy: string | null;
};

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
        where: { counterpartyId: trade.counterpartyId, side: "SELL", entryType: "CREDIT" },
        _sum: { amountPkr: true },
      }),
      prisma.counterpartyLedgerEntry.aggregate({
        where: { counterpartyId: trade.counterpartyId, side: "SELL", entryType: "DEBIT" },
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

/** CEO decision on a release-on-credit request (reject requires a reason). */
export async function ceoResolveClearWithoutPayment(
  truckId: string,
  ceoName: string,
  decision: "APPROVE" | "REJECT",
  reason?: string,
): Promise<PendingTruck> {
  const row = await saleTruckOrThrow(truckId);
  if (row.saleStage !== "CLEAR_PENDING_CEO") {
    throw new Error("This truck is not awaiting CEO clearance");
  }
  if (decision === "REJECT") {
    const why = reason?.trim();
    if (!why) throw new Error("A rejection reason is required");
    await transition(truckId, ["CLEAR_PENDING_CEO"], "AWAITING_BALANCE");
    const trade = row.assignedTradeRef
      ? await prisma.trade.findUnique({
          where: { tradeRef: row.assignedTradeRef },
          select: { traderName: true },
        })
      : null;
    const { recordRejection } = await import("@/server/rejections");
    await recordRejection({
      kind: "SELL_RELEASE_CEO",
      refLabel: row.gatepassNo,
      gatepassNo: row.gatepassNo,
      tradeRef: row.assignedTradeRef,
      counterpartyName: row.counterpartyName,
      amountPkr: numOrNull(row.saleExpectedPkr),
      traderName: trade?.traderName ?? null,
      rejectedBy: ceoName,
      rejectedRole: "CEO",
      reason: why,
    });
    return freshTruck(truckId);
  }
  await transition(truckId, ["CLEAR_PENDING_CEO"], "CLEARED_UNPAID", {
    saleCeoApprovedBy: ceoName,
    saleCeoApprovedAt: new Date(),
  });
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
  warehouseLocation: string | null;
  warehouseAddress: string | null;
  buyerName: string;
  buyerNtn: string | null;
  buyerAddress: string | null;
  commodityName: string | null;
  commodityCode: string | null;
  weightKg: number;
  weightMt: number;
  tradeRef: string | null;
  deliveryTerms: string | null;
  deliveryOrderDate: Date | null;
  actualDeliveryDate: Date;
  doExecutionApprovedBy: string | null;
  doFinanceApprovedBy: string | null;
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
  const weightKg = num(row.weightKg);

  const [trade, warehouse] = await Promise.all([
    truck.assignedTradeRef
      ? prisma.trade.findUnique({
          where: { tradeRef: truck.assignedTradeRef },
          select: {
            incoterms: true,
            counterparty: { select: { ntn: true, address: true, country: true } },
          },
        })
      : Promise.resolve(null),
    prisma.location.findFirst({
      where: { name: truck.warehouseName, type: "WAREHOUSE" },
      select: { city: true, province: true, address: true },
    }),
  ]);

  const buyerNtn = trade?.counterparty.ntn ?? null;
  const buyerAddress =
    trade?.counterparty.address?.trim() || trade?.counterparty.country?.trim() || null;
  const warehouseLocation = warehouse?.city?.trim() || warehouse?.province?.trim() || null;

  return {
    gatepassNo: truck.gatepassNo,
    gateOutSlipNo: truck.gateOutSlipNo ?? null,
    deliveryOrderNo: truck.deliveryOrderNo ?? null,
    issuedAt:
      truck.doFinanceApprovedAt ??
      truck.saleFinanceApprovedAt ??
      truck.saleCeoApprovedAt ??
      null,
    truckNo: truck.truckNo,
    transporterName: truckTransporterName(truck),
    transporterPhone: truckTransporterPhone(truck),
    builtyDetails: truck.builtyDetails ?? null,
    warehouseName: truck.warehouseName,
    warehouseLocation,
    warehouseAddress: warehouse?.address?.trim() || null,
    buyerName: truck.counterpartyName,
    buyerNtn,
    buyerAddress,
    commodityName: truck.commodityName ?? null,
    commodityCode: truck.commodityCode ?? null,
    weightKg,
    weightMt: weightKg / 1000,
    tradeRef: truck.assignedTradeRef ?? null,
    deliveryTerms: trade?.incoterms?.trim() || "Ex-Warehouse",
    deliveryOrderDate: truck.doExecutionApprovedAt ?? truck.doFinanceApprovedAt ?? null,
    actualDeliveryDate: truck.saleReleasedAt ?? truck.arrivalDate,
    doExecutionApprovedBy: truck.doExecutionApprovedBy ?? null,
    doFinanceApprovedBy: truck.doFinanceApprovedBy ?? null,
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
