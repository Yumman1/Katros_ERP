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
 *                        (they defaulted while the market rose): a DEBIT note
 *                        posts on their receivable (SELL) account;
 *   settlement < rate  → we owe the seller (we walked away while the market
 *                        fell): a credit note posts as a DEBIT on their
 *                        payable (BUY) account — more money we owe them.
 * Nothing posts until the CEO approves; a rejection leaves the trade open.
 */

/** Payload carried by a TRADE/CANCEL change request. */
export type CancellationPayload = {
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
 * Build the CANCEL payload for a locked trade at a given settlement price.
 * With no price yet (form just opened) it previews at settlement = rate:
 * diff 0, no ledger entry.
 */
export async function buildCancellationPayload(
  tradeRef: string,
  settlementPricePerMaund?: number | null,
): Promise<CancellationPayload & { counterpartyName: string; traderName: string }> {
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

/**
 * Apply a CEO-approved TRADE/CANCEL change request: cancel the trade + contract
 * and post the debit/credit note the payload priced. Recomputes the amount from
 * the payload figures — never trusts a pre-computed total blindly.
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

  const settlement = num(payload.settlementPricePerMaund);
  const rate = num(payload.ratePerMaund);
  const openMaunds = num(payload.openMaunds);
  const diffPerMaund = round2(settlement - rate);
  const amountPkr = round2(Math.abs(diffPerMaund) * openMaunds);

  const row = await prisma.trade.findUnique({
    where: { tradeRef: ref },
    select: { counterpartyId: true, counterparty: { select: { name: true } } },
  });
  if (!row) return false;

  let noteRef: string | null = null;
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.trade.updateMany({
      where: { tradeRef: ref },
      data: { tradeStatus: "CANCELLED" },
    });
    await tx.executionContract.updateMany({
      where: { tradeRef: ref },
      data: { contractStatus: "Close" },
    });
    if (amountPkr > 0.005) {
      const seq = await nextRef(COUNTER.CANCELLATION_NOTE, tx);
      const isDebit = diffPerMaund > 0;
      noteRef = `${isDebit ? "DN" : "CN"}-${String(seq).padStart(5, "0")}`;
      await tx.counterpartyLedgerEntry.create({
        data: {
          counterpartyId: row.counterpartyId,
          // Seller owes us → receivable (SELL). We owe seller → payable (BUY).
          side: isDebit ? "SELL" : "BUY",
          entryType: "DEBIT",
          amountPkr,
          sourceType: "ADJUSTMENT",
          sourceRef: noteRef,
          tradeRef: ref,
          note:
            `${isDebit ? "Debit" : "Credit"} note ${noteRef} — cancellation of ${ref}: ` +
            `${openMaunds.toLocaleString("en-PK")} maund open × ` +
            `(settlement ${settlement.toLocaleString("en-PK")} − rate ${rate.toLocaleString("en-PK")}) ` +
            `= ${(isDebit ? amountPkr : -amountPkr).toLocaleString("en-PK")} PKR ` +
            `(${isDebit ? "seller owes us" : "we owe seller"})`,
        },
      });
    }
  });

  await appendTradeActivity(ref, {
    actorName: approvedBy,
    actorSide: "CEO",
    kind: "CANCELLED",
    requiresApproval: false,
    summary:
      amountPkr > 0.005
        ? `Trade cancelled by CEO — ${noteRef} for ${amountPkr.toLocaleString("en-PK")} PKR (${diffPerMaund > 0 ? "seller owes us" : "we owe seller"}; settlement ${settlement.toLocaleString("en-PK")} vs rate ${rate.toLocaleString("en-PK")}/maund on ${num(payload.openQtyMt).toLocaleString("en-PK")} MT open)`
        : `Trade cancelled by CEO — settlement price equals the trade rate (${rate.toLocaleString("en-PK")}/maund), no ledger entry`,
  });
  return true;
}
