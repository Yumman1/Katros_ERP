import { stockAsOf } from "@/lib/warehouse-stock-utils";
import { normWarehouseName } from "@/lib/warehouse-allocation";
import {
  buildWarehouseUtilizationView,
  warehouseCapacityForDivision,
  warehouseStorageDivisionForCommodity,
  type WarehouseStorageDivision,
} from "@/lib/warehouse-utilization";

export type WarehouseAvailabilityRow = {
  id: string;
  name: string;
  code: string | null;
  grainDivisionSqFt: number | null;
  balesDivisionSqFt: number | null;
  capacitySqFt: number | null;
  utilizationPct: number | null;
  /** Overall warehouse floor availability (shared grain + bale sq ft). */
  availabilityPct: number | null;
  remainingSqFt: number | null;
  stockMt: number | null;
  stockBales: number | null;
  /** Free room if storing grain (MT) — grain division sq ft / MT. */
  availableGrainMt: number | null;
  /** Free bale balance converted to grain MT via sq ft divisions. */
  availableBaleAsGrainMt: number | null;
  balanceBales: number | null;
  /** Division used for this commodity (grain vs bale). */
  storageDivision: WarehouseStorageDivision | null;
  /** Availability % for the commodity's division only. */
  divisionAvailabilityPct: number | null;
  /** Free MT in the commodity's division (grain MT or bale-as-grain MT). */
  divisionAvailableMt: number | null;
  /** Theoretical capacity (MT) for the commodity's division (grain MT, or bale capacity as grain-MT equivalent). */
  capacityMt: number | null;
  /** MT committed to goods still incoming — Σ max(0, qtyMt − fulfilledQtyMt) over open BUY contract allocations. */
  allocatedMt: number;
  /** Free (unallocated) MT = max(0, capacityMt − stock − allocatedMt). */
  unallocatedMt: number | null;
};

type WarehouseLoc = {
  id: string;
  name: string;
  code?: string | null;
  capacitySqFt?: number | null;
  balesDivisionSqFt?: number | null;
  grainDivisionSqFt?: number | null;
};

type MovementInbound = {
  warehouseName: string;
  tradeRef: string;
  receiveDate: Date | string;
  allocatedQtyMt: number;
  status: string;
};

type MovementOutbound = {
  warehouseName: string;
  tradeRef: string;
  dispatchDate: Date | string;
  allocatedQtyMt: number;
  status: string;
};

type ContractRef = {
  tradeRef: string;
  commodityCode: string;
  quantityUnit: string;
};

export type WarehouseAvailabilityCommodity = {
  code: string;
  category?: string | null;
  unit?: string | null;
};

const EMPTY_ROW = (loc: WarehouseLoc): WarehouseAvailabilityRow => ({
  id: loc.id,
  name: loc.name,
  code: loc.code ?? null,
  grainDivisionSqFt: loc.grainDivisionSqFt ?? null,
  balesDivisionSqFt: loc.balesDivisionSqFt ?? null,
  capacitySqFt: loc.capacitySqFt ?? null,
  utilizationPct: null,
  availabilityPct: null,
  remainingSqFt: null,
  stockMt: null,
  stockBales: null,
  availableGrainMt: null,
  availableBaleAsGrainMt: null,
  balanceBales: null,
  storageDivision: null,
  divisionAvailabilityPct: null,
  divisionAvailableMt: null,
  capacityMt: null,
  allocatedMt: 0,
  unallocatedMt: null,
});

/** Same utilization math as Execution → Warehouses → Utilization. */
export function computeWarehouseAvailability(
  locations: WarehouseLoc[],
  inbound: MovementInbound[],
  outbound: MovementOutbound[],
  contracts: ContractRef[],
  asOf: Date | null = null,
  commodity?: WarehouseAvailabilityCommodity | null,
  /** Σ max(0, qtyMt − fulfilledQtyMt) per warehouse over open BUY contract allocations, keyed by normWarehouseName. */
  allocatedMtByWarehouse?: ReadonlyMap<string, number> | null,
): WarehouseAvailabilityRow[] {
  const contractByRef = new Map(
    contracts.map((c) => [
      c.tradeRef,
      { commodityCode: c.commodityCode, quantityUnit: c.quantityUnit },
    ]),
  );

  const storageDivision = commodity
    ? warehouseStorageDivisionForCommodity({
        commodityCode: commodity.code,
        quantityUnit: commodity.unit ?? "MT",
        category: commodity.category,
      })
    : null;

  return locations.map((loc) => {
    const allocatedMt = allocatedMtByWarehouse?.get(normWarehouseName(loc.name)) ?? 0;
    const stock = stockAsOf(loc.name, inbound, outbound, contractByRef, asOf);
    const view = buildWarehouseUtilizationView(loc, stock);
    if (!view) return { ...EMPTY_ROW(loc), allocatedMt };

    const divisionCapacity = storageDivision
      ? warehouseCapacityForDivision(view, storageDivision)
      : null;

    // Capacity (MT) for the commodity's division. Grain: capacitySqFt / grainDivisionSqFt
    // (via estimatedCapacityMt convention). Bale: bale capacity as grain-MT equivalent.
    const capacityMt =
      storageDivision === "bale"
        ? view.grainDivisionSqFt > 0
          ? (view.theoreticalMaxBales * view.balesDivisionSqFt) / view.grainDivisionSqFt
          : null
        : view.theoreticalMaxMt;

    // Free room before allocations = max(0, capacityMt − stock) in this division
    // (availableGrainMt / divisionAvailableMt already floor at 0 and account for
    // mixed grain + bale stock via the shared floor-area math).
    const freeBeforeAllocMt = storageDivision
      ? divisionCapacity?.availableMt ?? null
      : view.availableGrainMt;
    const unallocatedMt =
      freeBeforeAllocMt != null ? Math.max(0, freeBeforeAllocMt - allocatedMt) : null;

    return {
      id: loc.id,
      name: loc.name,
      code: loc.code ?? null,
      grainDivisionSqFt: view.grainDivisionSqFt,
      balesDivisionSqFt: view.balesDivisionSqFt,
      capacitySqFt: view.capacitySqFt,
      utilizationPct: view.utilizationPct,
      availabilityPct: view.availabilityPct,
      remainingSqFt: view.remainingSqFt,
      stockMt: view.stockMt,
      stockBales: view.stockBales,
      availableGrainMt: view.availableGrainMt,
      availableBaleAsGrainMt: view.availableBaleAsGrainMt,
      balanceBales: view.balanceBales,
      storageDivision,
      divisionAvailabilityPct: divisionCapacity?.availabilityPct ?? null,
      divisionAvailableMt: divisionCapacity?.availableMt ?? null,
      capacityMt,
      allocatedMt,
      unallocatedMt,
    };
  });
}

export function availabilityTone(pct: number | null | undefined): "high" | "medium" | "low" | "unknown" {
  if (pct == null || !Number.isFinite(pct)) return "unknown";
  if (pct >= 30) return "high";
  if (pct >= 10) return "medium";
  return "low";
}

export function fmtCapacityMt(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
