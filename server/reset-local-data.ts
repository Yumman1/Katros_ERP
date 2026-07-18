import { prisma } from "@/server/db";

/**
 * Wipe all operational CTRM data from Postgres.
 *
 * Deleting Trade cascades TradeActivity, ExecutionContract (and its
 * ContractWarehouseAllocation rows), InboundReceipt, OutboundDispatch,
 * SpotPurchaseEvent and PaymentRequest. Deleting PendingTruck cascades
 * GatepassDocument. PendingTruck is removed before Trade so its
 * assignedTradeRef / gateInvoiceTradeRef references never dangle, and all
 * deletions run in one transaction for an all-or-nothing reset.
 */
export async function resetAllLocalData(): Promise<{ cleared: string[] }> {
  await prisma.$transaction([
    prisma.pendingTruck.deleteMany({}),
    prisma.trade.deleteMany({}),
    prisma.changeRequest.deleteMany({}),
    prisma.deskMarketPrice.deleteMany({}),
    prisma.positionAdjustment.deleteMany({}),
    prisma.refCounter.deleteMany({}),
  ]);

  return {
    cleared: [
      "PendingTruck (+ GatepassDocument)",
      "Trade (+ TradeActivity, ExecutionContract, InboundReceipt, OutboundDispatch, SpotPurchaseEvent, PaymentRequest)",
      "ChangeRequest",
      "DeskMarketPrice",
      "PositionAdjustment",
      "RefCounter",
    ],
  };
}
