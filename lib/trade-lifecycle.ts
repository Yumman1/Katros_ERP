import { TradeStatus } from "@prisma/client";

type TradeLike = {
  tradeStatus: TradeStatus;
  submittedToExecution?: boolean;
  settlementRequested?: boolean;
  directSettled?: boolean;
};

/** Trader draft — not yet sent to execution; direct edits allowed. */
export function isTraderDraft(trade: TradeLike): boolean {
  return trade.tradeStatus === TradeStatus.PENDING && trade.submittedToExecution !== true;
}

/** Trader may edit price, quantity, and commission only while PENDING (draft or unreviewed). */
export function traderCanEditTrade(trade: TradeLike): boolean {
  return trade.tradeStatus === TradeStatus.PENDING;
}

/** @deprecated use traderCanEditTrade */
export function traderCanEditFromList(trade: TradeLike): boolean {
  return traderCanEditTrade(trade);
}

/**
 * Trader may cancel only *before* execution locks the trade — i.e. while still
 * PENDING (draft or submitted-but-unreviewed). Once locked, a contract exists
 * and deliveries can be allocated against it, so cancellation is closed off.
 */
export function traderCanCancelTrade(trade: TradeLike): boolean {
  if (trade.tradeStatus !== TradeStatus.PENDING) return false;
  // Trades in direct settlement are frozen — settle or cancel the settlement first.
  if (trade.settlementRequested === true || trade.directSettled === true) return false;
  return true;
}

/** Why cancellation is unavailable — surfaced as a tooltip in the trades list. */
export function traderCancelBlockedReason(trade: TradeLike): string | null {
  if (traderCanCancelTrade(trade)) return null;
  if (trade.tradeStatus === TradeStatus.CANCELLED) return "This trade is already cancelled";
  if (trade.settlementRequested === true || trade.directSettled === true) {
    return "Trade is in direct settlement — cancel the settlement request first";
  }
  return "Locked trades cannot be cancelled — cancellation is only possible before execution locks the trade";
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
    return trade.submittedToExecution ? "Unreviewed" : "Draft";
  }
  if (trade.tradeStatus === TradeStatus.EXECUTED || trade.tradeStatus === TradeStatus.SETTLED) {
    return "Closed";
  }
  if (trade.tradeStatus === TradeStatus.CONFIRMED) return "Locked";
  if (trade.tradeStatus === TradeStatus.LOCKED) return "Locked";
  if (trade.tradeStatus === TradeStatus.CANCELLED) return "Cancelled";
  return trade.tradeStatus;
}
