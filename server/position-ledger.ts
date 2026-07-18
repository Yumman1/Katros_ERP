import { readPersisted, writePersisted } from "@/server/local-persist";
import { syncAllLockedContracts, getLockedContracts, getInboundReceipts, getOutboundDispatches, syncExecutionFromDisk } from "@/server/execution-store";
import { mockAllTraderTrades } from "@/server/dummy-data";
import { inboundStockDelta, outboundStockDelta } from "@/lib/inventory-stock";

export const POSITION_ADJUSTMENTS_FILE = "position-adjustments.json";

type AdjustmentsStore = {
  /** Commodity code → manual delta added by execution head (MT equivalent). */
  byCommodity: Record<string, number>;
  /** Optional per commodity+warehouse overrides. */
  byWarehouse?: Record<string, number>;
};

function emptyAdjustments(): AdjustmentsStore {
  return { byCommodity: {}, byWarehouse: {} };
}

export function getPositionAdjustments(): AdjustmentsStore {
  const snap = readPersisted<AdjustmentsStore>(POSITION_ADJUSTMENTS_FILE);
  return snap ?? emptyAdjustments();
}

export function setPositionAdjustment(commodityCode: string, deltaMt: number) {
  const code = commodityCode.trim().toUpperCase();
  const store = getPositionAdjustments();
  if (!Number.isFinite(deltaMt) || deltaMt === 0) {
    delete store.byCommodity[code];
  } else {
    store.byCommodity[code] = deltaMt;
  }
  writePersisted(POSITION_ADJUSTMENTS_FILE, store);
  return store;
}

export type CommodityPositionRow = {
  commodityCode: string;
  commodityName: string;
  unit: string;
  /** Signed paper from locked trades: buys add, sells subtract (open qty). */
  paperLong: number;
  paperShort: number;
  paperNet: number;
  physicalInbound: number;
  physicalOutbound: number;
  physicalNet: number;
  /** paperNet − physicalNet (positive = more paper than physical). */
  variance: number;
  manualAdjustment: number;
  /** physicalNet + manualAdjustment — execution view of bookable stock. */
  adjustedPhysical: number;
  /** paperNet − adjustedPhysical */
  netPosition: number;
  openBuyTrades: number;
  openSellTrades: number;
};

function addCommodity(
  map: Map<string, CommodityPositionRow>,
  code: string,
  name: string,
  unit: string,
): CommodityPositionRow {
  const key = code.trim().toUpperCase();
  const existing = map.get(key);
  if (existing) return existing;
  const row: CommodityPositionRow = {
    commodityCode: key,
    commodityName: name,
    unit: unit || "MT",
    paperLong: 0,
    paperShort: 0,
    paperNet: 0,
    physicalInbound: 0,
    physicalOutbound: 0,
    physicalNet: 0,
    variance: 0,
    manualAdjustment: 0,
    adjustedPhysical: 0,
    netPosition: 0,
    openBuyTrades: 0,
    openSellTrades: 0,
  };
  map.set(key, row);
  return row;
}

export function computePositionLedger(options?: { traderName?: string }): CommodityPositionRow[] {
  syncExecutionFromDisk();
  syncAllLockedContracts();

  const adjustments = getPositionAdjustments();
  const map = new Map<string, CommodityPositionRow>();

  const contracts = getLockedContracts({ openOnly: false });
  const contractByRef = new Map(contracts.map((c) => [c.tradeRef, c]));

  let trades = mockAllTraderTrades();
  if (options?.traderName) {
    const tn = options.traderName.trim().toLowerCase();
    trades = trades.filter((t) => t.traderName.trim().toLowerCase() === tn);
  }

  const tradeRefs = new Set(trades.map((t) => t.tradeRef));

  for (const c of contracts) {
    if (options?.traderName && !tradeRefs.has(c.tradeRef)) continue;
    const row = addCommodity(map, c.commodityCode, c.commodityName, c.quantityUnit);
    const open = c.openQtyMt;
    if (c.direction === "BUY") {
      row.paperLong += open;
      row.openBuyTrades += 1;
    } else {
      row.paperShort += open;
      row.openSellTrades += 1;
    }
  }

  for (const r of getInboundReceipts()) {
    const c = contractByRef.get(r.tradeRef);
    if (options?.traderName && c && !tradeRefs.has(c.tradeRef)) continue;
    const code = c?.commodityCode ?? "UNK";
    const name = c?.commodityName ?? code;
    const unit = c?.quantityUnit ?? "MT";
    const row = addCommodity(map, code, name, unit);
    const delta = inboundStockDelta(r.status, r.allocatedQtyMt);
    if (delta > 0) row.physicalInbound += delta;
    row.physicalNet += delta;
  }

  for (const d of getOutboundDispatches()) {
    const c = contractByRef.get(d.tradeRef);
    if (options?.traderName && c && !tradeRefs.has(c.tradeRef)) continue;
    const code = c?.commodityCode ?? "UNK";
    const name = c?.commodityName ?? code;
    const unit = c?.quantityUnit ?? "MT";
    const row = addCommodity(map, code, name, unit);
    const delta = outboundStockDelta(d.status, d.allocatedQtyMt);
    if (delta < 0) row.physicalOutbound += Math.abs(delta);
    row.physicalNet += delta;
  }

  for (const row of map.values()) {
    row.paperNet = row.paperLong - row.paperShort;
    row.manualAdjustment = adjustments.byCommodity[row.commodityCode] ?? 0;
    row.adjustedPhysical = row.physicalNet + row.manualAdjustment;
    row.variance = row.paperNet - row.physicalNet;
    row.netPosition = row.paperNet - row.adjustedPhysical;
  }

  return [...map.values()]
    .filter(
      (r) =>
        Math.abs(r.paperNet) > 0.001 ||
        Math.abs(r.physicalNet) > 0.001 ||
        Math.abs(r.manualAdjustment) > 0.001,
    )
    .sort((a, b) => a.commodityCode.localeCompare(b.commodityCode));
}
