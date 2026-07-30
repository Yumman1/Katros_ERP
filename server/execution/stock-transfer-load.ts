/**
 * Reading shifts for stock arithmetic.
 *
 * Kept apart from `stock-transfers.ts` because that module asks `movements.ts`
 * how much a warehouse holds before letting stock leave it, while `movements.ts`
 * needs shifts to answer. Splitting the read out breaks the cycle.
 */

import { StockTransferStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import { num, numOrNull } from "@/server/db/convert";
import type { StockTransferStockInput } from "@/lib/inventory-stock";

export type StockTransferStockRow = StockTransferStockInput & {
  commodityName: string;
  movedAt: Date | null;
};

/** Shifts that move stock — drafts and cancellations affect nothing. */
export async function loadStockTransfersForStock(): Promise<StockTransferStockRow[]> {
  const rows = await prisma.stockTransfer.findMany({
    where: { status: { in: [StockTransferStatus.IN_TRANSIT, StockTransferStatus.RECEIVED] } },
    select: {
      commodityCode: true,
      commodityName: true,
      fromWarehouseName: true,
      toWarehouseName: true,
      dispatchedQtyMt: true,
      receivedQtyMt: true,
      status: true,
      dispatchedAt: true,
      receivedAt: true,
    },
  });
  return rows.map((r) => ({
    commodityCode: r.commodityCode,
    commodityName: r.commodityName,
    fromWarehouseName: r.fromWarehouseName,
    toWarehouseName: r.toWarehouseName,
    dispatchedQtyMt: num(r.dispatchedQtyMt),
    receivedQtyMt: numOrNull(r.receivedQtyMt),
    status: r.status,
    movedAt: r.receivedAt ?? r.dispatchedAt,
  }));
}
