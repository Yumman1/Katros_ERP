import { TradeStatus } from "@prisma/client";

type TradeLike = {
  tradeStatus: TradeStatus;
  submittedToExecution?: boolean;
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
  return trade.tradeStatus;
}
