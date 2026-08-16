import type { trpc } from "@/lib/trpc/client";

type Utils = ReturnType<typeof trpc.useUtils>;

/** Refresh execution desk, contract queues, and trader book after trade lifecycle changes. */
export function invalidateTradeFlowCaches(utils: Utils, tradeRef?: string) {
  void utils.trader.myTrades.invalidate();
  void utils.trader.deskSummary.invalidate();
  void utils.trader.actionItems.invalidate();
  void utils.trader.myExposure.invalidate();
  void utils.trader.tradeFulfillment.invalidate();
  // Booking, locking, closing or cancelling a trade all move the net position.
  void utils.trader.seasonNetPositions.invalidate();
  // An edit may have corrected the counterparty record, which every trade,
  // ledger and truck row shows by name.
  void utils.trader.referenceData.invalidate();
  void utils.execution.sellCounterparties.invalidate();
  void utils.execution.counterpartyLedgers.invalidate();
  void utils.execution.pendingForLock.invalidate();
  void utils.execution.openTrades.invalidate();
  void utils.execution.lockedContracts.invalidate();
  void utils.execution.deskSummary.invalidate();
  void utils.execution.pendingWarehouseAllocation.invalidate();
  void utils.execution.spotPipeline.invalidate();
  void utils.finance.pendingPayments.invalidate();
  invalidateFinanceApprovalBadges(utils);
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
  // Stock in or out changes inventory, so the net position moves with it.
  void utils.trader.seasonNetPositions.invalidate();
  void utils.execution.inventoryValuation.invalidate();
  void utils.execution.counterpartyLedgers.invalidate();
  void utils.execution.vouchers.invalidate();
  void utils.policy.overdueLedgerAlerts.invalidate();
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
  void utils.policy.rejections.invalidate();
  void utils.execution.doExecutionApprovals.invalidate();
  void utils.finance.doApprovals.invalidate();
  invalidateFinanceApprovalBadges(utils);
  invalidateTradeFlowCaches(utils);
  invalidateGateOpsCaches(utils);
}

/** Shared polling for live desks — mutation invalidation is primary; this is a safety net. */
export const DESK_REFETCH_MS = 60_000;

/** Finance sidebar + nav approval badges (payments, DO, vouchers, change requests). */
export function invalidateFinanceApprovalBadges(utils: Utils) {
  void utils.finance.approvalBadges.invalidate();
  void utils.finance.pendingVouchersCount.invalidate();
  void utils.finance.doApprovals.invalidate();
}
