import { TradeStatus } from "@prisma/client";

type TradeLike = {
  tradeStatus: TradeStatus;
  submittedToExecution?: boolean;
  settlementRequested?: boolean;
  directSettled?: boolean;
  settlementClosedAt?: Date | null;
};

/** Settled, but the trade amount is still being gathered in the ledger. */
export function isSettlementCollecting(trade: TradeLike): boolean {
  return trade.directSettled === true && trade.settlementClosedAt == null;
}

/** Trader draft — not yet sent to execution; direct edits allowed. */
export function isTraderDraft(trade: TradeLike): boolean {
  return trade.tradeStatus === TradeStatus.PENDING && trade.submittedToExecution !== true;
}

/** Trader may edit price, quantity, and commission only while PENDING (draft, submitted or not). */
export function traderCanEditTrade(trade: TradeLike): boolean {
  return trade.tradeStatus === TradeStatus.PENDING;
}

/** @deprecated use traderCanEditTrade */
export function traderCanEditFromList(trade: TradeLike): boolean {
  return traderCanEditTrade(trade);
}

/**
 * Trader may cancel at any stage before the trade finishes. Before lock the
 * cancel is simple; once LOCKED it settles in money — a debit note priced
 * against the settlement market goes to the CEO, and the trade only cancels
 * on approval.
 */
export function traderCanCancelTrade(trade: TradeLike): boolean {
  if (
    trade.tradeStatus !== TradeStatus.PENDING &&
    trade.tradeStatus !== TradeStatus.LOCKED &&
    trade.tradeStatus !== TradeStatus.CONFIRMED
  ) {
    return false;
  }
  // Trades in direct settlement are frozen — settle or cancel the settlement first.
  if (trade.settlementRequested === true || trade.directSettled === true) return false;
  return true;
}

/** Locked cancellation goes through the debit note + CEO approval. */
export function traderCancelNeedsDebitNote(trade: TradeLike): boolean {
  return (
    traderCanCancelTrade(trade) &&
    (trade.tradeStatus === TradeStatus.LOCKED || trade.tradeStatus === TradeStatus.CONFIRMED)
  );
}

/** Why cancellation is unavailable — surfaced as a tooltip in the trades list. */
export function traderCancelBlockedReason(trade: TradeLike): string | null {
  if (traderCanCancelTrade(trade)) return null;
  if (trade.tradeStatus === TradeStatus.CANCELLED) return "This trade is already cancelled";
  if (trade.settlementRequested === true || trade.directSettled === true) {
    return "Trade is in direct settlement — cancel the settlement request first";
  }
  return "This trade has finished executing and can no longer be cancelled";
}

export function traderEditRequiresCeoApproval(trade: TradeLike): boolean {
  if (!traderCanEditTrade(trade)) return false;
  return !isTraderDraft(trade);
}

export function isExecutionUnreviewed(trade: TradeLike): boolean {
  return trade.tradeStatus === TradeStatus.PENDING && trade.submittedToExecution === true;
}

type OpenTradeLockGate = {
  pendingTraderReview?: boolean;
  pendingTraderPrice?: boolean;
  requiresWarehouse?: boolean;
  warehouseSplitApproved?: boolean;
};

/** Execution may lock only when price is set, trader review is clear, and warehouse split is head-approved. */
export function executionCanLockOpenTrade(trade: OpenTradeLockGate): boolean {
  if (trade.pendingTraderReview) return false;
  if (trade.pendingTraderPrice) return false;
  if (trade.requiresWarehouse && trade.warehouseSplitApproved !== true) return false;
  return true;
}

export function traderListStatusLabel(trade: TradeLike & { submittedToExecution?: boolean }): string {
  if (trade.tradeStatus === TradeStatus.PENDING) {
    // A submitted trade and an unsubmitted one are the same thing at different
    // desks — the trader's Drafts tab and execution's Draft Trades queue hold
    // the same rows, so they carry the same word.
    return trade.submittedToExecution ? "Draft — with execution" : "Draft";
  }
  if (trade.tradeStatus === TradeStatus.SETTLED) {
    return isSettlementCollecting(trade) ? "Settling" : "Closed";
  }
  if (trade.tradeStatus === TradeStatus.EXECUTED) return "Closed";
  if (trade.tradeStatus === TradeStatus.CONFIRMED) return "Locked";
  if (trade.tradeStatus === TradeStatus.LOCKED) return "Locked";
  if (trade.tradeStatus === TradeStatus.CANCELLED) return "Cancelled";
  return trade.tradeStatus;
}
