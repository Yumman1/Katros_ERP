import { aggregateWarehouseStock } from "@/lib/warehouse-utilization";
import {
  inboundStockDelta,
  outboundStockDelta,
  stockTransferDelta,
  type StockTransferStockInput,
} from "@/lib/inventory-stock";

export function stockAsOf(
  warehouseName: string,
  inbound: {
    warehouseName: string;
    tradeRef: string;
    receiveDate: Date | string;
    allocatedQtyMt: number;
    status: string;
  }[],
  outbound: {
    warehouseName: string;
    tradeRef: string;
    dispatchDate: Date | string;
    allocatedQtyMt: number;
    status: string;
  }[],
  contractByRef: Map<string, { commodityCode: string; quantityUnit: string }>,
  asOf: Date | null,
  transfers: (StockTransferStockInput & { movedAt: Date | string | null })[] = [],
) {
  const rows: { commodityCode: string; quantityUnit: string; netQty: number }[] = [];
  for (const r of inbound) {
    if (r.warehouseName !== warehouseName) continue;
    if (asOf && new Date(r.receiveDate) > asOf) continue;
    const c = contractByRef.get(r.tradeRef);
    const delta = inboundStockDelta(r.status, r.allocatedQtyMt);
    if (delta === 0) continue;
    rows.push({
      commodityCode: c?.commodityCode ?? "UNK",
      quantityUnit: c?.quantityUnit ?? "MT",
      netQty: delta,
    });
  }
  for (const d of outbound) {
    if (d.warehouseName !== warehouseName) continue;
    if (asOf && new Date(d.dispatchDate) > asOf) continue;
    const delta = outboundStockDelta(d.status, d.allocatedQtyMt);
    if (delta === 0) continue;
    const c = contractByRef.get(d.tradeRef);
    rows.push({
      commodityCode: c?.commodityCode ?? "UNK",
      quantityUnit: c?.quantityUnit ?? "MT",
      netQty: delta,
    });
  }
  for (const t of transfers) {
    if (asOf && t.movedAt && new Date(t.movedAt) > asOf) continue;
    const delta = stockTransferDelta(warehouseName, t);
    if (delta === 0) continue;
    rows.push({ commodityCode: t.commodityCode, quantityUnit: "MT", netQty: delta });
  }
  // aggregateWarehouseStock floors each row at zero, so a movement out has to be
  // netted against the movements in before it gets there — otherwise dispatches
  // and shifts out are dropped and the warehouse reads permanently full.
  return aggregateWarehouseStock(netByCommodity(rows));
}

function netByCommodity(
  rows: { commodityCode: string; quantityUnit: string; netQty: number }[],
): { commodityCode: string; quantityUnit: string; netQty: number }[] {
  const net = new Map<string, { commodityCode: string; quantityUnit: string; netQty: number }>();
  for (const r of rows) {
    const key = `${r.commodityCode}|${r.quantityUnit}`;
    const acc = net.get(key);
    if (acc) acc.netQty += r.netQty;
    else net.set(key, { ...r });
  }
  return Array.from(net.values());
}

export function hadActivityInRange(
  warehouseName: string,
  inbound: { warehouseName: string; receiveDate: Date | string }[],
  outbound: { warehouseName: string; dispatchDate: Date | string }[],
  from: Date | null,
  to: Date | null,
) {
  if (!from && !to) return true;
  for (const r of inbound) {
    if (r.warehouseName !== warehouseName) continue;
    const d = new Date(r.receiveDate);
    if (from && d < from) continue;
    if (to && d > to) continue;
    return true;
  }
  for (const d of outbound) {
    if (d.warehouseName !== warehouseName) continue;
    const dt = new Date(d.dispatchDate);
    if (from && dt < from) continue;
    if (to && dt > to) continue;
    return true;
  }
  return false;
}
