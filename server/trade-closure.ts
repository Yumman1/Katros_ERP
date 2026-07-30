import type { Prisma } from "@prisma/client";
import { TradeStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import { COUNTER, nextRef } from "@/server/db/counters";
import { canonicalTraderName, traderNamesMatch } from "@/lib/trader-identity";
import { freeCloseFloorQty } from "@/lib/contract-closure";
import { getContractByRef } from "@/server/execution-store";
import { closeLockedContract } from "@/server/execution/contracts";
import { mockTradeByRefGlobal } from "@/server/dummy-data";
import { appendTradeActivity } from "@/server/trade-activity";

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Purchase closure & cancellation.
 *
 * Closing: delivery landed within tolerance (received ≥ contract − tolerance)
 * → the trader closes alone. Short of the floor → a CLOSE change request goes
 * to the CEO, exactly as before.
 *
 * Cancelling a LOCKED trade: the remainder is being abandoned, which settles
 * in money. The trader fills a debit note — the trade rate is shown, the
 * settlement price is entered — and the CEO approves. On approval:
 *   settlement = rate  → the trade cancels with no ledger entry;
 *   settlement > rate  → the seller owes the difference on the open quantity
 *                        (they defaulted while the market rose): a DEBIT note;
 *   settlement < rate  → we owe the seller (we walked away while the market
 *                        fell): a CREDIT note.
 * Either way the note posts on the ledger account the trade itself lives on —
 * a purchase settles on the purchase account — because that is where anyone
 * reconciling the trade will look for it. It posts UNPAID and weighs on the
 * balance until an execution voucher settles it.
 *
 * Nothing posts until the CEO approves; a rejection leaves the trade open.
 */

/** Payload carried by a TRADE/CLOSE or TRADE/CANCEL change request. */
export type SettlementNotePayload = {
  ratePerMaund: number;
  settlementPricePerMaund: number;
  diffPerMaund: number;
  openQtyMt: number;
  openMaunds: number;
  /** |diff| × open maunds; 0 = cancel with no ledger entry. */
  amountPkr: number;
  /** Who the note lands on: "SELLER_OWES_US" | "WE_OWE_SELLER" | "NONE". */
  direction: "SELLER_OWES_US" | "WE_OWE_SELLER" | "NONE";
};

/**
 * Trade rate per maund INCLUDING commission — what the workbook calls "price
 * per maund after commission" and what the debit note settles against.
 */
export function ratePerMaundInclCommission(trade: {
  pricePerCanonicalQty: unknown;
  price: unknown;
  commissionAmount: unknown;
  quantity: unknown;
  priceKgPerUnit?: unknown;
}): { ratePerMaund: number; maundsPerMt: number } {
  const kgPerMaund = num(trade.priceKgPerUnit) || 40;
  const maundsPerMt = 1000 / kgPerMaund;
  const perMt = num(trade.pricePerCanonicalQty) || num(trade.price) * maundsPerMt;
  const qty = num(trade.quantity);
  const commissionPerMt = qty > 0 ? num(trade.commissionAmount) / qty : 0;
  return {
    ratePerMaund: round2((perMt + commissionPerMt) / maundsPerMt),
    maundsPerMt,
  };
}

/**
 * Price the note for a locked trade's undelivered quantity at a given
 * settlement price — the same arithmetic whether the open quantity is being
 * written off by a short close or abandoned by a cancellation. With no price
 * yet (form just opened) it previews at settlement = rate: diff 0, no entry.
 */
export async function buildSettlementNotePayload(
  tradeRef: string,
  settlementPricePerMaund?: number | null,
): Promise<SettlementNotePayload & { counterpartyName: string; traderName: string }> {
  const trade = await prisma.trade.findUnique({
    where: { tradeRef },
    select: {
      pricePerCanonicalQty: true,
      price: true,
      commissionAmount: true,
      quantity: true,
      priceKgPerUnit: true,
      traderName: true,
      counterparty: { select: { name: true } },
    },
  });
  if (!trade) throw new Error("Trade not found");

  const contract = await getContractByRef(tradeRef);
  if (!contract) throw new Error("Locked contract not found");
  const openQtyMt = Math.max(0, num(contract.openQtyMt));

  const { ratePerMaund, maundsPerMt } = ratePerMaundInclCommission(trade);
  const settlement =
    settlementPricePerMaund != null && Number.isFinite(settlementPricePerMaund) && settlementPricePerMaund > 0
      ? settlementPricePerMaund
      : ratePerMaund;
  const openMaunds = round2(openQtyMt * maundsPerMt);
  const diffPerMaund = round2(settlement - ratePerMaund);
  const amountPkr = round2(Math.abs(diffPerMaund) * openMaunds);

  return {
    ratePerMaund,
    settlementPricePerMaund: round2(settlement),
    diffPerMaund,
    openQtyMt,
    openMaunds,
    amountPkr,
    direction:
      amountPkr <= 0.005 ? "NONE" : diffPerMaund > 0 ? "SELLER_OWES_US" : "WE_OWE_SELLER",
    counterpartyName: trade.counterparty.name,
    traderName: trade.traderName,
  };
}

/**
 * Close a locked purchase whose received quantity is within tolerance —
 * trader-only, no CEO involved. Below the floor this throws and the caller
 * falls back to the CLOSE change-request path.
 */
export async function closeTradeWithinTolerance(
  traderName: string,
  tradeRef: string,
  closedBy: string,
): Promise<void> {
  const ref = tradeRef.trim();
  const contract = await getContractByRef(ref);
  if (!contract) throw new Error("Locked contract not found");
  if (contract.contractStatus !== "Open") throw new Error("This contract is already closed");
  if (!traderNamesMatch(contract.traderName, canonicalTraderName(traderName))) {
    throw new Error("You can only close your own trades");
  }

  const floor = freeCloseFloorQty(num(contract.contractualQtyMt), num(contract.quantityToleranceMt));
  const received = num(contract.receivedQtyMt);
  if (received + 1e-9 < floor) {
    throw new Error(
      `Received ${received.toLocaleString("en-PK")} MT is below the tolerance floor of ${floor.toLocaleString("en-PK")} MT — closing short needs CEO approval`,
    );
  }

  await closeLockedContract(ref, closedBy);
  await appendTradeActivity(ref, {
    actorName: closedBy,
    actorSide: "TRADER",
    kind: "CLOSED",
    requiresApproval: false,
    summary: `Trade closed within tolerance — received ${received.toLocaleString("en-PK")} MT of ${num(contract.contractualQtyMt).toLocaleString("en-PK")} MT (floor ${floor.toLocaleString("en-PK")} MT)`,
  });
}

/** Recompute the note from the payload's own figures — never trust a total. */
function priceNoteFromPayload(payload: Record<string, unknown>) {
  const settlement = num(payload.settlementPricePerMaund);
  const rate = num(payload.ratePerMaund);
  const openMaunds = num(payload.openMaunds);
  const diffPerMaund = round2(settlement - rate);
  return {
    settlement,
    rate,
    openMaunds,
    diffPerMaund,
    amountPkr: round2(Math.abs(diffPerMaund) * openMaunds),
  };
}

/**
 * Post the debit/credit note for an abandoned open quantity inside a running
 * transaction. Returns the note ref, or null when settlement equals the rate
 * and there is nothing to post.
 */
async function postSettlementNote(
  tx: Prisma.TransactionClient,
  input: {
    counterpartyId: string;
    tradeRef: string;
    priced: ReturnType<typeof priceNoteFromPayload>;
    /** What abandoned the quantity — reads on the ledger line. */
    reason: "cancellation" | "short close";
    /** Ledger account the trade lives on: BUY for a purchase, SELL for a sale. */
    side: "BUY" | "SELL";
  },
): Promise<string | null> {
  const { priced } = input;
  if (priced.amountPkr <= 0.005) return null;
  const isDebit = priced.diffPerMaund > 0;
  const seq = await nextRef(COUNTER.CANCELLATION_NOTE, tx);
  const noteRef = `${isDebit ? "DN" : "CN"}-${String(seq).padStart(5, "0")}`;
  await tx.counterpartyLedgerEntry.create({
    data: {
      counterpartyId: input.counterpartyId,
      // A note against a purchase belongs on the purchase account, whichever
      // way the money runs — the seller's buy ledger is where that trade lives,
      // and splitting the two would hide the claim from the account it settles.
      side: input.side,
      entryType: "DEBIT",
      amountPkr: priced.amountPkr,
      sourceType: "ADJUSTMENT",
      sourceRef: noteRef,
      tradeRef: input.tradeRef,
      // The claim is open until a voucher settles it.
      noteStatus: "UNPAID",
      note:
        `${isDebit ? "Debit" : "Credit"} note ${noteRef} — ${input.reason} of ${input.tradeRef}: ` +
        `${priced.openMaunds.toLocaleString("en-PK")} maund open × ` +
        `(settlement ${priced.settlement.toLocaleString("en-PK")} − rate ${priced.rate.toLocaleString("en-PK")}) ` +
        `= ${(isDebit ? priced.amountPkr : -priced.amountPkr).toLocaleString("en-PK")} PKR ` +
        `(${isDebit ? "seller owes us" : "we owe seller"})`,
    },
  });
  return noteRef;
}

function noteSummary(
  verb: string,
  priced: ReturnType<typeof priceNoteFromPayload>,
  noteRef: string | null,
  openQtyMt: number,
): string {
  if (!noteRef) {
    return `${verb} by CEO — settlement price equals the trade rate (${priced.rate.toLocaleString("en-PK")}/maund), no ledger entry`;
  }
  return (
    `${verb} by CEO — ${noteRef} for ${priced.amountPkr.toLocaleString("en-PK")} PKR ` +
    `(${priced.diffPerMaund > 0 ? "seller owes us" : "we owe seller"}; settlement ` +
    `${priced.settlement.toLocaleString("en-PK")} vs rate ${priced.rate.toLocaleString("en-PK")}/maund ` +
    `on ${openQtyMt.toLocaleString("en-PK")} MT open)`
  );
}

/**
 * Apply a CEO-approved TRADE/CANCEL change request: cancel the trade + contract
 * and post the note the payload priced.
 */
export async function applyCancellationChangeRequest(
  tradeRef: string,
  payload: Record<string, unknown>,
  approvedBy: string,
): Promise<boolean> {
  const ref = tradeRef.trim();
  const trade = await mockTradeByRefGlobal(ref);
  if (!trade) return false;
  if (trade.tradeStatus === TradeStatus.CANCELLED) return true; // already done

  const priced = priceNoteFromPayload(payload);
  const row = await prisma.trade.findUnique({
    where: { tradeRef: ref },
    select: { counterpartyId: true, direction: true },
  });
  if (!row) return false;

  let noteRef: string | null = null;
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.trade.updateMany({ where: { tradeRef: ref }, data: { tradeStatus: "CANCELLED" } });
    await tx.executionContract.updateMany({
      where: { tradeRef: ref },
      data: { contractStatus: "Close" },
    });
    noteRef = await postSettlementNote(tx, {
      counterpartyId: row.counterpartyId,
      tradeRef: ref,
      priced,
      reason: "cancellation",
      side: row.direction === "BUY" ? "BUY" : "SELL",
    });
  });

  await appendTradeActivity(ref, {
    actorName: approvedBy,
    actorSide: "CEO",
    kind: "CANCELLED",
    requiresApproval: false,
    summary: noteSummary("Trade cancelled", priced, noteRef, num(payload.openQtyMt)),
  });
  return true;
}

/**
 * Apply a CEO-approved TRADE/CLOSE change request. Closing short writes off the
 * undelivered quantity, which settles in money exactly as a cancellation does,
 * so the request carries the same note and posts it here. A close request with
 * no note payload (settlement not priced) just closes the contract.
 */
export async function applyCloseChangeRequest(
  tradeRef: string,
  payload: Record<string, unknown> | null | undefined,
  approvedBy: string,
): Promise<boolean> {
  const ref = tradeRef.trim();
  await closeLockedContract(ref, approvedBy);

  if (!payload || payload.settlementPricePerMaund == null) return true;
  const priced = priceNoteFromPayload(payload);
  if (priced.amountPkr <= 0.005) {
    await appendTradeActivity(ref, {
      actorName: approvedBy,
      actorSide: "CEO",
      kind: "CLOSED",
      requiresApproval: false,
      summary: noteSummary("Trade closed short", priced, null, num(payload.openQtyMt)),
    });
    return true;
  }

  const row = await prisma.trade.findUnique({
    where: { tradeRef: ref },
    select: { counterpartyId: true, direction: true },
  });
  if (!row) return true; // contract is closed either way

  let noteRef: string | null = null;
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    noteRef = await postSettlementNote(tx, {
      counterpartyId: row.counterpartyId,
      tradeRef: ref,
      priced,
      reason: "short close",
      side: row.direction === "BUY" ? "BUY" : "SELL",
    });
  });

  await appendTradeActivity(ref, {
    actorName: approvedBy,
    actorSide: "CEO",
    kind: "CLOSED",
    requiresApproval: false,
    summary: noteSummary("Trade closed short", priced, noteRef, num(payload.openQtyMt)),
  });
  return true;
}
