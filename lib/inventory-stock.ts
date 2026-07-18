/**
 * When inbound/outbound movements affect warehouse stock balances.
 * Gatepass trucks count as unallocated until assigned to a trade.
 */

import { kgToQuantityUnit } from "@/lib/unit-conversion";

export function inboundStockDelta(status: string, qtyMt: number): number {
  if (status === "DRAFT") return 0;
  return qtyMt;
}

export function outboundStockDelta(status: string, qtyMt: number): number {
  if (status === "AT_GATE") return 0;
  if (status === "WEIGHED" || status === "FINANCE_PENDING" || status === "RELEASED") {
    return -qtyMt;
  }
  return 0;
}

export function countsAsReleasedOutbound(status: string): boolean {
  return status === "WEIGHED" || status === "FINANCE_PENDING" || status === "RELEASED";
}

export type PendingTruckStockInput = {
  movementType: "INBOUND" | "OUTBOUND";
  status: string;
  remainingKg: number;
  warehouseName: string;
  commodityCode?: string | null;
  commodityName?: string | null;
};

export function pendingTruckUnallocatedQtyMt(
  truck: PendingTruckStockInput,
  unit = "MT",
): number {
  if (truck.status === "ASSIGNED") return 0;
  if (truck.remainingKg <= 0) return 0;
  return kgToQuantityUnit(truck.remainingKg, unit);
}

export type LocationCommodityInventoryRow = {
  warehouseName: string;
  commodityCode: string;
  commodityName: string;
  quantityUnit: string;
  unallocatedQty: number;
  allocatedQty: number;
  netQty: number;
  unallocatedInbound: number;
  unallocatedOutbound: number;
  allocatedInbound: number;
  allocatedOutbound: number;
};

type TradeCommodity = { code: string; name: string; unit: string };

export function buildLocationCommodityInventory(input: {
  inbound: {
    warehouseName: string;
    tradeRef: string;
    allocatedQtyMt: number;
    status: string;
  }[];
  outbound: {
    warehouseName: string;
    tradeRef: string;
    allocatedQtyMt: number;
    status: string;
  }[];
  pendingTrucks: PendingTruckStockInput[];
  commodityForTradeRef: (tradeRef: string) => TradeCommodity | null;
}): LocationCommodityInventoryRow[] {
  const map = new Map<string, LocationCommodityInventoryRow>();

  const ensure = (
    warehouseName: string,
    commodityCode: string,
    commodityName: string,
    quantityUnit: string,
  ) => {
    const key = `${warehouseName}|${commodityCode}|${quantityUnit}`;
    const row =
      map.get(key) ??
      {
        warehouseName,
        commodityCode,
        commodityName,
        quantityUnit,
        unallocatedQty: 0,
        allocatedQty: 0,
        netQty: 0,
        unallocatedInbound: 0,
        unallocatedOutbound: 0,
        allocatedInbound: 0,
        allocatedOutbound: 0,
      };
    map.set(key, row);
    return row;
  };

  for (const r of input.inbound) {
    const trade = input.commodityForTradeRef(r.tradeRef);
    if (!trade) continue;
    const row = ensure(r.warehouseName, trade.code, trade.name, trade.unit);
    const qty = inboundStockDelta(r.status, r.allocatedQtyMt);
    if (qty <= 0) continue;
    row.allocatedInbound += qty;
  }

  for (const d of input.outbound) {
    const trade = input.commodityForTradeRef(d.tradeRef);
    if (!trade) continue;
    const row = ensure(d.warehouseName, trade.code, trade.name, trade.unit);
    if (!countsAsReleasedOutbound(d.status)) continue;
    row.allocatedOutbound += d.allocatedQtyMt;
  }

  for (const t of input.pendingTrucks) {
    const code = (t.commodityCode ?? "").trim();
    if (!code) continue;
    const unit = "MT";
    const qty = pendingTruckUnallocatedQtyMt(t, unit);
    if (qty <= 0) continue;
    const row = ensure(t.warehouseName, code, t.commodityName?.trim() || code, unit);
    if (t.movementType === "INBOUND") row.unallocatedInbound += qty;
    else row.unallocatedOutbound += qty;
  }

  for (const row of map.values()) {
    row.unallocatedQty = row.unallocatedInbound - row.unallocatedOutbound;
    row.allocatedQty = row.allocatedInbound - row.allocatedOutbound;
    row.netQty = row.unallocatedQty + row.allocatedQty;
  }

  return Array.from(map.values()).sort(
    (a, b) =>
      a.warehouseName.localeCompare(b.warehouseName) ||
      a.commodityCode.localeCompare(b.commodityCode),
  );
}

/** Net physical stock for one commodity at a warehouse from recorded movements. */
export function netCommodityStockMt(
  warehouseName: string,
  commodityCode: string,
  inbound: {
    id?: string;
    warehouseName: string;
    tradeRef: string;
    allocatedQtyMt: number;
    status: string;
  }[],
  outbound: {
    id?: string;
    warehouseName: string;
    tradeRef: string;
    allocatedQtyMt: number;
    status: string;
  }[],
  commodityForTradeRef: (tradeRef: string) => string | null,
  exclude?: { inboundId?: string; outboundId?: string },
): number {
  const wh = warehouseName.trim().toLowerCase();
  const code = commodityCode.trim();
  let net = 0;
  for (const r of inbound) {
    if (exclude?.inboundId && r.id === exclude.inboundId) continue;
    if (r.warehouseName.trim().toLowerCase() !== wh) continue;
    if (commodityForTradeRef(r.tradeRef) !== code) continue;
    net += inboundStockDelta(r.status, r.allocatedQtyMt);
  }
  for (const d of outbound) {
    if (exclude?.outboundId && d.id === exclude.outboundId) continue;
    if (d.warehouseName.trim().toLowerCase() !== wh) continue;
    if (commodityForTradeRef(d.tradeRef) !== code) continue;
    net += outboundStockDelta(d.status, d.allocatedQtyMt);
  }
  return net;
}
