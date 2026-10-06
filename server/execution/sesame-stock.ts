import { processingReservedKg } from "./processing-reservations";
import type { Prisma } from "@prisma/client";
import { tradeEntity } from "@/lib/sesame-entity";
import { inboundStockDelta, outboundStockDelta, stockTransferDelta } from "@/lib/inventory-stock";
type DB = Prisma.TransactionClient;
const n = (v: unknown) => Number(v ?? 0);
export async function lockSesameOwnership(db: DB, code: string) {
  // Serialize ownership transfers and truck reservations across BOTH entities.
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`sesame-ownership:${code}`}))::text`;
}
export async function fzcoCustody(db: DB, code: string) {
  const entries = await db.sesameOwnershipEntry.findMany({ where: { commodityCode: code } });
  const map = new Map<string, number>();
  for (const e of entries) {
    const wh = e.warehouseName ?? "";
    map.set(wh, (map.get(wh) ?? 0) + (e.toEntity === "FZCO" ? n(e.quantityMt) : 0) - (e.fromEntity === "FZCO" ? n(e.quantityMt) : 0));
  }
  return map;
}

/** Pakistan can only commit stock it owns, excluding already reserved trucks. */
export async function pakistanAvailable(db: DB, code: string, warehouse: string, excludeTruckId?: string, excludeDispatchId?: string) {
  const [physical, custody, pending] = await Promise.all([
    physicalStock(db, code, excludeDispatchId), fzcoCustody(db, code),
    db.pendingTruck.findMany({ where: { commodityCode: code, executionEntity: "PAK", status: { not: "ASSIGNED" }, ...(excludeTruckId ? { id: { not: excludeTruckId } } : {}) } }),
  ]);
  const same = (name: string) => name.trim().toLowerCase() === warehouse.trim().toLowerCase();
  let qty = [...physical].filter(([wh]) => same(wh)).reduce((s,[,v])=>s+v,0) - [...custody].filter(([wh]) => same(wh)).reduce((s,[,v])=>s+v,0);
  for (const t of pending) if (same(t.warehouseName) && t.movementType === "OUTBOUND") qty -= n(t.remainingKg)/1000;
  return qty - await processingReservedKg(db,code,warehouse)/1000;
}
export async function reservedFzco(db: DB, code: string) {
  const rows = await db.outboundDispatch.findMany({ where: { status: "AT_GATE", trade: { commodity: { code } } }, select: { warehouseName: true, allocatedQtyMt: true, trade: { select: { tradeParams: true } } } });
  const map = new Map<string, number>();
  for (const r of rows) if (tradeEntity(r.trade.tradeParams) === "FZCO") map.set(r.warehouseName, (map.get(r.warehouseName) ?? 0) + n(r.allocatedQtyMt));
  return map;
}
export async function physicalStock(db: DB, code: string, excludeDispatchId?: string) {
  const refs = (await db.trade.findMany({ where: { commodity: { code } }, select: { tradeRef: true } })).map(t => t.tradeRef);
  const [ins, outs, shifts] = await Promise.all([
    db.inboundReceipt.findMany({ where: { tradeRef: { in: refs } } }),
    db.outboundDispatch.findMany({ where: { tradeRef: { in: refs }, ...(excludeDispatchId ? { id: { not: excludeDispatchId } } : {}) } }),
    db.stockTransfer.findMany({ where: { commodityCode: code } }),
  ]);
  const map = new Map<string, number>();
  const add = (wh: string, qty: number) => { if (wh) map.set(wh, (map.get(wh) ?? 0) + qty); };
  for (const r of ins) add(r.warehouseName, inboundStockDelta(r.status, n(r.allocatedQtyMt)));
  const unassigned = await db.pendingTruck.findMany({ where: { commodityCode: code, executionEntity: "PAK", movementType: "INBOUND", status: { not: "ASSIGNED" } } });
  for (const t of unassigned) add(t.warehouseName, n(t.remainingKg)/1000);
  for (const r of outs) add(r.warehouseName, outboundStockDelta(r.status, n(r.allocatedQtyMt)));
  for (const t of shifts) for (const wh of new Set([t.fromWarehouseName, t.toWarehouseName])) if (wh) add(wh, stockTransferDelta(wh, { ...t, dispatchedQtyMt: n(t.dispatchedQtyMt), receivedQtyMt: t.receivedQtyMt == null ? null : n(t.receivedQtyMt) }));
  return map;
}
