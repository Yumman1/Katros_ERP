import { prisma } from "@/server/db";
import { num } from "@/server/db/convert";
import {
  syncAllLockedContracts,
  getLockedContracts,
  getInboundReceipts,
  getOutboundDispatches,
  syncExecutionFromDisk,
} from "@/server/execution-store";
import { mockAllTraderTrades } from "@/server/dummy-data";
import { inboundStockDelta, outboundStockDelta } from "@/lib/inventory-stock";

/** @deprecated legacy JSON snapshot name — adjustments live in PositionAdjustment now. */
export const POSITION_ADJUSTMENTS_FILE = "position-adjustments.json";

type AdjustmentsStore = {
  /** Commodity code → manual delta added by execution head (MT equivalent). */
  byCommodity: Record<string, number>;
  /** Optional per commodity+warehouse overrides (key `CODE::Warehouse name`). */
  byWarehouse?: Record<string, number>;
};

function emptyAdjustments(): AdjustmentsStore {
  return { byCommodity: {}, byWarehouse: {} };
}

export async function getPositionAdjustments(): Promise<AdjustmentsStore> {
  const rows = await prisma.positionAdjustment.findMany();
  const store = emptyAdjustments();
  for (const row of rows) {
    const code = row.commodityCode.trim().toUpperCase();
    const delta = num(row.deltaMt);
    if (row.warehouseName === "") {
      store.byCommodity[code] = delta;
    } else {
      store.byWarehouse![`${code}::${row.warehouseName}`] = delta;
    }
  }
  return store;
}

export async function setPositionAdjustment(
  commodityCode: string,
  deltaMt: number,
): Promise<AdjustmentsStore> {
  const code = commodityCode.trim().toUpperCase();
  if (!Number.isFinite(deltaMt) || deltaMt === 0) {
    await prisma.positionAdjustment.deleteMany({
      where: { commodityCode: code, warehouseName: "" },
    });
  } else {
    await prisma.positionAdjustment.upsert({
      where: { commodityCode_warehouseName: { commodityCode: code, warehouseName: "" } },
      create: { commodityCode: code, warehouseName: "", deltaMt },
      update: { deltaMt },
    });
  }
  return getPositionAdjustments();
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

export async function computePositionLedger(options?: {
  traderName?: string;
}): Promise<CommodityPositionRow[]> {
  await syncExecutionFromDisk();
  await syncAllLockedContracts();

  const adjustments = await getPositionAdjustments();
  const map = new Map<string, CommodityPositionRow>();

  const contracts = await getLockedContracts({ openOnly: false });
  const contractByRef = new Map(contracts.map((c) => [c.tradeRef, c]));

  let trades = await mockAllTraderTrades();
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

  for (const r of await getInboundReceipts()) {
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

  for (const d of await getOutboundDispatches()) {
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
