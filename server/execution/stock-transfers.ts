/**
 * Internal stock shifting — moving grain we already own between warehouses.
 *
 * A shift is not a trade. Nobody is bought from or sold to, no invoice is
 * raised and no ledger entry is posted; the only thing that changes is which
 * warehouse floor the stock sits on. That is why it cannot ride on
 * InboundReceipt / OutboundDispatch, both of which require a `tradeRef` and
 * read their commodity from the contract behind it. A transfer carries its own
 * commodity instead.
 *
 * Both legs still pass the gate, so the gate register looks the same as any
 * other truck day. The gatepasses are booked against the internal counterparty
 * (`INTERNAL_COUNTERPARTY_NAME`) rather than a supplier.
 *
 *   DRAFT ──dispatch──▶ IN_TRANSIT ──receive──▶ RECEIVED
 *
 * Source stock drops at dispatch, destination stock rises at receipt. Grain in
 * transit is on neither warehouse's books, so a shift can never be counted
 * twice, and a truck that never arrives shows up as a real hole rather than
 * quietly balancing itself.
 */

import type { Prisma } from "@prisma/client";
import { StockTransferStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import { num, numOrNull } from "@/server/db/convert";
import { COUNTER, nextRef } from "@/server/db/counters";
import { normWarehouseName } from "@/lib/warehouse-allocation";
import { getSystemUserId } from "@/server/db/system-user";
import { getAvailableOutboundStockMt } from "@/server/execution/movements";

/** The party a shift is booked against — us, not a supplier. */
export const INTERNAL_COUNTERPARTY_NAME = "Kastros";

/** Transit loss under this many MT is weighbridge noise, not a real shortfall. */
const TRANSIT_TOLERANCE_MT = 0.005;

export type StockTransferRow = {
  id: string;
  transferRef: string;
  commodityCode: string;
  commodityName: string;
  fromWarehouseName: string | null;
  externalOrigin: string | null;
  toWarehouseName: string;
  dispatchedQtyMt: number;
  receivedQtyMt: number | null;
  /** dispatched − received once received; null while in transit. */
  transitLossMt: number | null;
  truckNo: string;
  driverName: string | null;
  driverPhone: string | null;
  biltyNo: string | null;
  bags: number | null;
  outGatepassNo: string | null;
  inGatepassNo: string | null;
  status: StockTransferStatus;
  reason: string | null;
  remarks: string | null;
  createdByName: string | null;
  dispatchedAt: Date | null;
  receivedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
};

type TransferRecord = Prisma.StockTransferGetPayload<Record<string, never>>;

function toRow(t: TransferRecord): StockTransferRow {
  const dispatched = num(t.dispatchedQtyMt);
  const received = numOrNull(t.receivedQtyMt);
  return {
    id: t.id,
    transferRef: t.transferRef,
    commodityCode: t.commodityCode,
    commodityName: t.commodityName,
    fromWarehouseName: t.fromWarehouseName,
    externalOrigin: t.externalOrigin,
    toWarehouseName: t.toWarehouseName,
    dispatchedQtyMt: dispatched,
    receivedQtyMt: received,
    transitLossMt:
      received == null ? null : Math.round((dispatched - received) * 1e6) / 1e6,
    truckNo: t.truckNo,
    driverName: t.driverName,
    driverPhone: t.driverPhone,
    biltyNo: t.biltyNo,
    bags: t.bags,
    outGatepassNo: t.outGatepassNo,
    inGatepassNo: t.inGatepassNo,
    status: t.status,
    reason: t.reason,
    remarks: t.remarks,
    createdByName: t.createdByName,
    dispatchedAt: t.dispatchedAt,
    receivedAt: t.receivedAt,
    cancelledAt: t.cancelledAt,
    cancelReason: t.cancelReason,
    createdAt: t.createdAt,
  };
}

/**
 * The internal counterparty every shift gatepass is booked against. Created on
 * first use so a fresh database does not need a seeding step to shift stock.
 */
export async function ensureInternalCounterparty(): Promise<{ id: string; name: string }> {
  const existing = await prisma.counterparty.findFirst({
    where: { name: INTERNAL_COUNTERPARTY_NAME },
    select: { id: true, name: true },
  });
  if (existing) return existing;

  const seq = await nextRef(COUNTER.COUNTERPARTY);
  return prisma.counterparty.create({
    data: {
      name: INTERNAL_COUNTERPARTY_NAME,
      code: String(100000 + seq),
      // Not a trading partner — this party is us. It exists so a shift
      // gatepass has someone to be booked against, never to be traded with.
      type: "INTERNAL",
      country: "Pakistan",
      kycStatus: "VERIFIED",
      createdById: await getSystemUserId(),
    },
    select: { id: true, name: true },
  });
}

export async function listStockTransfers(filter?: {
  warehouseName?: string;
  commodityCode?: string;
  status?: StockTransferStatus;
}): Promise<StockTransferRow[]> {
  const where: Prisma.StockTransferWhereInput = {};
  if (filter?.status) where.status = filter.status;
  if (filter?.commodityCode?.trim()) where.commodityCode = filter.commodityCode.trim();
  if (filter?.warehouseName?.trim()) {
    const wh = filter.warehouseName.trim();
    where.OR = [{ fromWarehouseName: wh }, { toWarehouseName: wh }];
  }
  const rows = await prisma.stockTransfer.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
  });
  return rows.map(toRow);
}

/** Everything currently on the road — the reconciliation view that matters. */
export async function listInTransitTransfers(): Promise<StockTransferRow[]> {
  return listStockTransfers({ status: StockTransferStatus.IN_TRANSIT });
}

/**
 * Book a shift. An internal source must actually hold the stock; an external
 * origin (a yard we do not manage) is taken on trust because there is no book
 * to check it against.
 */
export async function createStockTransfer(input: {
  commodityCode: string;
  commodityName: string;
  fromWarehouseName?: string | null;
  externalOrigin?: string | null;
  toWarehouseName: string;
  dispatchedQtyMt: number;
  truckNo: string;
  driverName?: string | null;
  driverPhone?: string | null;
  biltyNo?: string | null;
  bags?: number | null;
  reason?: string | null;
  remarks?: string | null;
  createdByName?: string | null;
}): Promise<StockTransferRow> {
  const from = input.fromWarehouseName?.trim() || null;
  const to = input.toWarehouseName.trim();
  const origin = input.externalOrigin?.trim() || null;
  const qty = input.dispatchedQtyMt;

  if (!to) throw new Error("A destination warehouse is required");
  if (!from && !origin) {
    throw new Error(
      "Give either a source warehouse or the name of the outside yard the stock is coming from",
    );
  }
  if (from && normWarehouseName(from) === normWarehouseName(to)) {
    throw new Error("Source and destination are the same warehouse — nothing would move");
  }
  if (!Number.isFinite(qty) || qty <= 0) throw new Error("Quantity must be greater than zero");
  if (!input.truckNo.trim()) throw new Error("A truck number is required");

  if (from) {
    const available = await getAvailableOutboundStockMt(from, input.commodityCode);
    if (qty > available + TRANSIT_TOLERANCE_MT) {
      throw new Error(
        `${from} only holds ${available.toFixed(3)} MT of ${input.commodityCode}, so ${qty.toFixed(3)} MT cannot be shifted out`,
      );
    }
  }

  await ensureInternalCounterparty();
  const seq = await nextRef(COUNTER.STOCK_TRANSFER);
  const row = await prisma.stockTransfer.create({
    data: {
      transferRef: `SHF-${String(seq).padStart(5, "0")}`,
      commodityCode: input.commodityCode.trim(),
      commodityName: input.commodityName.trim() || input.commodityCode.trim(),
      fromWarehouseName: from,
      externalOrigin: from ? null : origin,
      toWarehouseName: to,
      dispatchedQtyMt: qty,
      truckNo: input.truckNo.trim(),
      driverName: input.driverName?.trim() || null,
      driverPhone: input.driverPhone?.trim() || null,
      biltyNo: input.biltyNo?.trim() || null,
      bags: input.bags ?? null,
      reason: input.reason?.trim() || null,
      remarks: input.remarks?.trim() || null,
      createdByName: input.createdByName?.trim() || null,
    },
  });
  return toRow(row);
}

/**
 * Gate the truck out of the source. From here the stock is off the source's
 * books and on nobody's until it is weighed in.
 */
export async function dispatchStockTransfer(
  id: string,
  actorName: string,
  overrideQtyMt?: number,
): Promise<StockTransferRow> {
  const row = await prisma.$transaction(async (tx) => {
    const t = await tx.stockTransfer.findUnique({ where: { id } });
    if (!t) throw new Error("Transfer not found");
    if (t.status !== StockTransferStatus.DRAFT) {
      throw new Error(`Only a draft transfer can be dispatched (this one is ${t.status})`);
    }
    const qty = overrideQtyMt ?? num(t.dispatchedQtyMt);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error("Quantity must be greater than zero");

    const seq = await nextRef(COUNTER.TRUCK_OUTBOUND, tx);
    return tx.stockTransfer.update({
      where: { id },
      data: {
        status: StockTransferStatus.IN_TRANSIT,
        dispatchedQtyMt: qty,
        outGatepassNo: `GP-OUT-${String(seq).padStart(4, "0")}`,
        dispatchedAt: new Date(),
        remarks: t.remarks,
        createdByName: t.createdByName ?? actorName,
      },
    });
  });
  return toRow(row);
}

/**
 * Weigh in at the destination. The weighed figure is what the destination
 * gains — a shortfall against what left is transit loss and stays visible as
 * the difference between the two legs rather than being written off here.
 */
export async function receiveStockTransfer(
  id: string,
  actorName: string,
  receivedQtyMt: number,
): Promise<StockTransferRow> {
  void actorName;
  const row = await prisma.$transaction(async (tx) => {
    const t = await tx.stockTransfer.findUnique({ where: { id } });
    if (!t) throw new Error("Transfer not found");
    if (t.status !== StockTransferStatus.IN_TRANSIT) {
      throw new Error(`Only a transfer in transit can be received (this one is ${t.status})`);
    }
    if (!Number.isFinite(receivedQtyMt) || receivedQtyMt <= 0) {
      throw new Error("Received quantity must be greater than zero");
    }
    if (receivedQtyMt > num(t.dispatchedQtyMt) + TRANSIT_TOLERANCE_MT) {
      throw new Error(
        `Received ${receivedQtyMt.toFixed(3)} MT is more than the ${num(t.dispatchedQtyMt).toFixed(3)} MT that left — check the weighbridge before booking it in`,
      );
    }
    const seq = await nextRef(COUNTER.TRUCK_INBOUND, tx);
    return tx.stockTransfer.update({
      where: { id },
      data: {
        status: StockTransferStatus.RECEIVED,
        receivedQtyMt,
        inGatepassNo: `GP-IN-${String(seq).padStart(4, "0")}`,
        receivedAt: new Date(),
      },
    });
  });
  return toRow(row);
}

/** Void a shift. Only before it is received — once stock has landed it is real. */
export async function cancelStockTransfer(
  id: string,
  reason: string,
): Promise<StockTransferRow> {
  const why = reason.trim();
  if (!why) throw new Error("A cancellation reason is required");
  const t = await prisma.stockTransfer.findUnique({ where: { id } });
  if (!t) throw new Error("Transfer not found");
  if (t.status === StockTransferStatus.RECEIVED) {
    throw new Error(
      "This transfer has already been received — shift the stock back instead of cancelling it",
    );
  }
  if (t.status === StockTransferStatus.CANCELLED) return toRow(t);
  const row = await prisma.stockTransfer.update({
    where: { id },
    data: {
      status: StockTransferStatus.CANCELLED,
      cancelledAt: new Date(),
      cancelReason: why,
    },
  });
  return toRow(row);
}

export { loadStockTransfersForStock } from "@/server/execution/stock-transfer-load";
