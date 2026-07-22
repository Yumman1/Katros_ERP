import type { trpc } from "@/lib/trpc/client";

type Utils = ReturnType<typeof trpc.useUtils>;

/** Refresh execution desk, contract queues, and trader book after trade lifecycle changes. */
export function invalidateTradeFlowCaches(utils: Utils, tradeRef?: string) {
  void utils.trader.myTrades.invalidate();
  void utils.trader.deskSummary.invalidate();
  void utils.trader.actionItems.invalidate();
  void utils.trader.myExposure.invalidate();
  void utils.trader.tradeFulfillment.invalidate();
  void utils.execution.pendingForLock.invalidate();
  void utils.execution.openTrades.invalidate();
  void utils.execution.lockedContracts.invalidate();
  void utils.execution.deskSummary.invalidate();
  void utils.execution.pendingWarehouseAllocation.invalidate();
  void utils.execution.spotPipeline.invalidate();
  void utils.finance.pendingPayments.invalidate();
  if (tradeRef) {
    void utils.trader.tradeByRef.invalidate({ tradeRef });
    void utils.execution.openTradeByRef.invalidate({ tradeRef });
    void utils.execution.lockedTradeByRef.invalidate({ tradeRef });
    void utils.execution.contractByRef.invalidate({ tradeRef });
  }
}

/** Gate / truck / inbound / outbound ops after assign, edit, or delete. */
export function invalidateGateOpsCaches(utils: Utils) {
  void utils.execution.pendingTrucks.invalidate();
  void utils.execution.inboundReceipts.invalidate();
  void utils.execution.outboundDispatches.invalidate();
  void utils.execution.lockedContracts.invalidate();
  void utils.execution.deskSummary.invalidate();
  void utils.execution.spotPipeline.invalidate();
  void utils.execution.pendingForLock.invalidate();
  void utils.execution.saleWorkflowRows.invalidate();
  void utils.execution.counterpartyLedgers.invalidate();
}

/** After CEO / department head resolves an approval that may touch master data or trades. */
export function invalidateApprovalCaches(utils: Utils) {
  void utils.team.changeRequests.invalidate();
  void utils.team.myChangeRequests.invalidate();
  void utils.team.pendingApprovals.invalidate();
  void utils.ceo.approvalQueue.invalidate();
  void utils.ceo.pendingApprovals.invalidate();
  void utils.ceo.dashboardSummary.invalidate();
  void utils.ceo.commodities.invalidate();
  void utils.execution.warehouseLocations.invalidate();
  void utils.trader.referenceData.invalidate();
  invalidateTradeFlowCaches(utils);
  invalidateGateOpsCaches(utils);
}

/** Shared polling for live desks — mutation invalidation is primary; this is a safety net. */
export const DESK_REFETCH_MS = 60_000;
