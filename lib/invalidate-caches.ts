import type { trpc } from "@/lib/trpc/client";

type Utils = ReturnType<typeof trpc.useUtils>;

/** Refresh execution desk, contract queues, and trader book after trade lifecycle changes. */
export function invalidateTradeFlowCaches(utils: Utils, tradeRef?: string) {
  void utils.trader.myTrades.invalidate();
  void utils.trader.deskSummary.invalidate();
  void utils.trader.actionItems.invalidate();
  void utils.trader.myExposure.invalidate();
  void utils.execution.pendingForLock.invalidate();
  void utils.execution.lockedContracts.invalidate();
  void utils.execution.deskSummary.invalidate();
  void utils.finance.pendingPayments.invalidate();
  if (tradeRef) {
    void utils.trader.tradeByRef.invalidate({ tradeRef });
    void utils.execution.contractByRef.invalidate({ tradeRef });
  }
}
