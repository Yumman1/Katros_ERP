import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const filePath = path.join(__dirname, "..", "server", "dummy-data.ts");
let s = fs.readFileSync(filePath, "utf8");

const markerStart = '      referenceA: "KAS-2026-10001",';
const markerEnd = "// --- Trader desk (mock) ---";
const startIdx = s.indexOf(markerStart);
if (startIdx < 0) {
  console.error("start marker not found");
  process.exit(1);
}
const start = startIdx;
const end = s.indexOf(markerEnd);
if (end < 0) {
  process.exit(1);
}

const stub = `export type ShipmentStatus =
  | "PLANNED"
  | "LOADING"
  | "IN_TRANSIT"
  | "AT_PORT"
  | "DELIVERED"
  | "DELAYED"
  | "CANCELLED";

export function mockInventorySummary() {
  return [];
}

export function mockInventoryList(_locationId?: string, _commodityId?: string, _status?: InventoryStatus) {
  return [];
}

export function mockInventoryMovements(_inventoryId?: string) {
  return [];
}

export function mockInventoryAging() {
  return [];
}

export function mockShipments(_filter?: { status?: ShipmentStatus; locationId?: string }) {
  return [];
}

export function mockShipmentSummary() {
  return {
    total: 0,
    inTransit: 0,
    delayed: 0,
    delivered30d: 0,
    totalQtyInPipeline: 0,
  };
}

export function mockLocationsDetail() {
  return getMergedLocations().map((loc) => ({
    id: loc.id,
    name: loc.name,
    type: LocationType.WAREHOUSE,
    country: "PK",
    region: loc.province ?? "Unassigned",
    capacityMt: loc.capacitySqFt ?? 0,
    onHand: 0,
    reserved: 0,
    inTransit: 0,
    value: 0,
    utilization: 0,
    commodities: [] as string[],
    activeShipments: 0,
  }));
}

export function mockCounterpartiesScm() {
  return getMergedCounterparties().map((cp) => ({
    id: cp.id,
    name: cp.name,
    code: cp.code,
    type: cp.type,
    country: cp.country,
    kycStatus: cp.kycStatus,
    onTimePct: null as number | null,
    openTrades: 0,
    openQtyMt: 0,
    lastTradeDate: null as Date | null,
  }));
}

export function mockSupplyChainOverview() {
  return {
    kpis: {
      totalOnHand: 0,
      totalReserved: 0,
      totalTransit: 0,
      totalValue: 0,
      availableToSell: 0,
      fillRate: 0,
      avgDwellDays: 0,
      shipmentsInPipeline: 0,
      delayedShipments: 0,
      avgLocationUtilization: 0,
      openPurchaseTrades: 0,
      awaitingReceipt: 0,
    },
    pipeline: [],
    alerts: [],
  };
}

export function mockPositionVsInventory() {
  return [];
}

export function mockKpis() {
  return {
    tradesYtd: 0,
    openTrades: 0,
    inventoryValue: 0,
    openMtmPnl: 0,
  };
}

export function mockTradeBlotter() {
  return [];
}

export function mockOpenBreaks() {
  return [];
}

export function mockCommodityList() {
  return getMergedCommodities();
}

export function mockTraceSearch(_q?: string, _commodityId?: string) {
  return [];
}

export function mockTraceById(_id: string) {
  return null;
}

export function mockTradesForCommodity() {
  return [];
}

`;

fs.writeFileSync(filePath, s.slice(0, start) + stub + s.slice(end));
console.log("patched", filePath);
