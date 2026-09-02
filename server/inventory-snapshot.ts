import { buildLocationCommodityInventory, type LocationCommodityInventoryRow } from "@/lib/inventory-stock";
import {
  aggregateWarehouseStorageMetrics,
  computeWarehouseCosting,
  costingInputFromLocation,
  type WarehouseCostingSummary,
} from "@/lib/warehouse-costing";
import {
  getInboundReceipts,
  getLockedContracts,
  getOutboundDispatches,
  getPendingTrucks,
} from "@/server/execution-store";
import { loadStockTransfersForStock } from "@/server/execution/stock-transfer-load";
import { getCompanyWarehouses } from "@/server/trader-master-data";

export type CompanyInventorySnapshot = {
  warehouseCount: number;
  inventoryRows: LocationCommodityInventoryRow[];
  totalNetMt: number;
  totalUnallocatedMt: number;
  storageNetwork: WarehouseCostingSummary | null;
};

/** Live warehouse stock — same arithmetic as Execution → Inventory and trader availability. */
export async function getCompanyInventorySnapshot(): Promise<CompanyInventorySnapshot> {
  const [companyWarehouses, lockedContracts, inbound, outbound, pendingTrucks, transfers] =
    await Promise.all([
      getCompanyWarehouses(),
      getLockedContracts({ openOnly: false }),
      getInboundReceipts(),
      getOutboundDispatches(),
      getPendingTrucks({}),
      loadStockTransfersForStock(),
    ]);

  const storageSummaries = companyWarehouses
    .map((loc) => computeWarehouseCosting(costingInputFromLocation(loc)))
    .filter((s): s is NonNullable<typeof s> => s != null);
  const storageNetwork = aggregateWarehouseStorageMetrics(storageSummaries);

  const contractByRef = new Map(lockedContracts.map((c) => [c.tradeRef, c]));
  const companyNames = new Set(
    companyWarehouses.map((w) => w.name.trim().toLowerCase()),
  );

  const inventoryRows = buildLocationCommodityInventory({
    inbound,
    outbound,
    pendingTrucks,
    transfers,
    commodityForTradeRef: (ref) => {
      const c = contractByRef.get(ref);
      if (!c) return null;
      return { code: c.commodityCode, name: c.commodityName, unit: c.quantityUnit };
    },
  }).filter((row) => companyNames.has(row.warehouseName.trim().toLowerCase()));

  const totalNetMt = inventoryRows.reduce((s, r) => s + r.netQty, 0);
  const totalUnallocatedMt = inventoryRows.reduce((s, r) => s + r.unallocatedQty, 0);

  return {
    warehouseCount: companyWarehouses.length,
    inventoryRows,
    totalNetMt,
    totalUnallocatedMt,
    storageNetwork,
  };
}
