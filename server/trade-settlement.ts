import { TradeStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import { num, numOrNull } from "@/server/db/convert";
import { canonicalTraderName, traderNamesMatch } from "@/lib/trader-identity";
import { appendTradeActivity } from "@/server/trade-activity";
import { recordRejection } from "@/server/rejections";

/**
 * Direct trade settlement — closing a trade with NO delivery and NO gatepass,
 * subject to CEO approval, and only while the trade is still PENDING (before
 * it is locked into an execution contract).
 *
 *   trader requests ──▶ settlementRequested (awaiting CEO)
 *   CEO approves ──▶ tradeStatus SETTLED, directSettled = true
 *   CEO rejects  ──▶ settlementRequested cleared (trade returns to normal)
 */

function assertSettleable(trade: {
  tradeStatus: TradeStatus;
  lockedAt: Date | null;
  directSettled: boolean;
}): void {
  if (trade.directSettled) throw new Error("This trade is already settled");
  if (trade.tradeStatus !== TradeStatus.PENDING || trade.lockedAt != null) {
    throw new Error(
      "Only trades that are not yet locked can be directly settled — locked trades close through execution/delivery",
    );
  }
}

/** Trader requests direct settlement of one of their own unlocked trades. */
export async function requestTradeSettlement(
  traderName: string,
  tradeRef: string,
  note: string,
): Promise<void> {
  const reason = note.trim();
  if (!reason) throw new Error("A settlement reason is required");
  const trade = await prisma.trade.findUnique({
    where: { tradeRef: tradeRef.trim() },
    select: {
      traderName: true,
      tradeStatus: true,
      lockedAt: true,
      directSettled: true,
      settlementRequested: true,
    },
  });
  if (!trade) throw new Error("Trade not found");
  if (!traderNamesMatch(trade.traderName, canonicalTraderName(traderName))) {
    throw new Error("You can only settle your own trades");
  }
  if (trade.settlementRequested) {
    throw new Error("A settlement request for this trade is already awaiting CEO approval");
  }
  assertSettleable(trade);
  await prisma.trade.update({
    where: { tradeRef: tradeRef.trim() },
    data: {
      settlementRequested: true,
      settlementNote: reason,
      settlementRequestedBy: traderName,
      settlementRequestedAt: new Date(),
    },
  });
  await appendTradeActivity(tradeRef.trim(), {
    actorName: traderName,
    actorSide: "TRADER",
    kind: "EDIT_REQUESTED",
    requiresApproval: true,
    summary: "Direct settlement requested — awaiting CEO approval",
    note: reason,
  });
}

/** Trader cancels their own pending settlement request. */
export async function cancelTradeSettlement(
  traderName: string,
  tradeRef: string,
): Promise<void> {
  const trade = await prisma.trade.findUnique({
    where: { tradeRef: tradeRef.trim() },
    select: { traderName: true, settlementRequested: true, directSettled: true },
  });
  if (!trade) throw new Error("Trade not found");
  if (!traderNamesMatch(trade.traderName, canonicalTraderName(traderName))) {
    throw new Error("You can only manage your own trades");
  }
  if (trade.directSettled) throw new Error("This trade is already settled — it cannot be reopened");
  if (!trade.settlementRequested) throw new Error("No settlement request is pending");
  await prisma.trade.update({
    where: { tradeRef: tradeRef.trim() },
    data: {
      settlementRequested: false,
      settlementNote: null,
      settlementRequestedBy: null,
      settlementRequestedAt: null,
    },
  });
}

export type CeoTradeSettlementRow = {
  tradeRef: string;
  traderName: string;
  direction: string;
  commodityName: string;
  commodityCode: string;
  counterpartyName: string;
  quantity: number;
  quantityUnit: string;
  /** Notional = quantity × mapped price. */
  notionalPkr: number;
  currency: string;
  note: string | null;
  requestedBy: string | null;
  requestedAt: Date | null;
};

/** Direct-settlement requests awaiting the CEO. */
export async function getCeoTradeSettlements(): Promise<CeoTradeSettlementRow[]> {
  const rows = await prisma.trade.findMany({
    where: { settlementRequested: true, directSettled: false },
    orderBy: { settlementRequestedAt: "asc" },
    include: { commodity: true, counterparty: true },
  });
  return rows.map((t) => ({
    tradeRef: t.tradeRef,
    traderName: t.traderName,
    direction: t.direction,
    commodityName: t.commodity.name,
    commodityCode: t.commodity.code,
    counterpartyName: t.counterparty.name,
    quantity: num(t.quantity),
    quantityUnit: t.quantityUnit,
    notionalPkr:
      num(t.quantity) * (numOrNull(t.pricePerCanonicalQty) ?? num(t.price)),
    currency: t.currency,
    note: t.settlementNote,
    requestedBy: t.settlementRequestedBy,
    requestedAt: t.settlementRequestedAt,
  }));
}

export async function getCeoTradeSettlementCount(): Promise<number> {
  return prisma.trade.count({ where: { settlementRequested: true, directSettled: false } });
}

/**
 * CEO decision. APPROVE → trade is directly settled (tradeStatus SETTLED, no
 * delivery, no gatepass, never becomes a contract). REJECT (reason required)
 * → the request is cleared and the trade returns to its normal draft state.
 */
export async function ceoResolveTradeSettlement(
  tradeRef: string,
  ceoName: string,
  decision: "APPROVE" | "REJECT",
  reason?: string,
): Promise<void> {
  const ref = tradeRef.trim();
  const trade = await prisma.trade.findUnique({
    where: { tradeRef: ref },
    select: {
      traderName: true,
      tradeStatus: true,
      lockedAt: true,
      directSettled: true,
      settlementRequested: true,
      settlementNote: true,
      counterparty: { select: { name: true } },
    },
  });
  if (!trade) throw new Error("Trade not found");
  if (!trade.settlementRequested || trade.directSettled) {
    throw new Error("This trade has no pending settlement request");
  }

  if (decision === "REJECT") {
    const why = reason?.trim();
    if (!why) throw new Error("A rejection reason is required");
    await prisma.trade.update({
      where: { tradeRef: ref },
      data: {
        settlementRequested: false,
        settlementNote: null,
        settlementRequestedBy: null,
        settlementRequestedAt: null,
      },
    });
    await recordRejection({
      kind: "TRADE_SETTLEMENT",
      refLabel: ref,
      tradeRef: ref,
      counterpartyName: trade.counterparty.name,
      amountPkr: null,
      traderName: trade.traderName,
      rejectedBy: ceoName,
      rejectedRole: "CEO",
      reason: why,
    });
    await appendTradeActivity(ref, {
      actorName: ceoName,
      actorSide: "CEO",
      kind: "EDIT_REJECTED",
      requiresApproval: false,
      summary: "CEO rejected the direct settlement request",
      note: why,
    });
    return;
  }

  // Approve — guard that it's still unlocked at the moment of settling.
  assertSettleable(trade);
  await prisma.trade.update({
    where: { tradeRef: ref },
    data: {
      settlementRequested: false,
      directSettled: true,
      tradeStatus: TradeStatus.SETTLED,
      settlementApprovedBy: ceoName,
      settlementApprovedAt: new Date(),
    },
  });
  await appendTradeActivity(ref, {
    actorName: ceoName,
    actorSide: "CEO",
    kind: "EDIT_APPROVED",
    requiresApproval: false,
    summary: "CEO approved direct settlement — trade closed with no delivery",
    note: trade.settlementNote,
  });
}
