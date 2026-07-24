/** Warehouse capacity & utilization — mirrors Inventory Sheet Summary tab formulas. */

import { isGrainCommodityCode } from "@/lib/trade-constants";

export type WarehouseCapacityInput = {
  capacitySqFt: number;
  balesDivisionSqFt: number;
  grainDivisionSqFt: number;
};

export type WarehouseStockInput = {
  stockMt: number;
  stockBales: number;
};

export type WarehouseUtilizationSummary = {
  consumedSqFt: number;
  remainingSqFt: number;
  utilizationPct: number;
  /** Theoretical max if the entire warehouse held only grain (MT). */
  theoreticalMaxMt: number;
  /** Theoretical max if the entire warehouse held only baled goods (MT). */
  theoreticalMaxBales: number;
  /** Remaining room expressed as grain MT after accounting for baled goods on hand. */
  balanceMt: number;
  /** Remaining room expressed as baled MT after accounting for grain on hand. */
  balanceBales: number;
};

export function kgToMt(kg: number): number {
  return kg / 1000;
}

export function roundCapacityMt(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value / 10) * 10;
}

export function roundCapacityBales(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value / 10) * 10;
}

/** Theoretical grain-only capacity (MT): MROUND(SqFt / Grain Division, 10) */
export function estimatedCapacityMt(capacity: WarehouseCapacityInput): number {
  const { capacitySqFt, grainDivisionSqFt } = capacity;
  if (capacitySqFt <= 0 || grainDivisionSqFt <= 0) return 0;
  return roundCapacityMt(capacitySqFt / grainDivisionSqFt);
}

/**
 * Theoretical baled-commodity capacity (MT): MROUND(SqFt / Bales Division, 10).
 * Bales division is now sq ft per MT of baled goods — the same metric as the
 * grain division — so this parallels estimatedCapacityMt exactly.
 */
export function estimatedCapacityBales(capacity: WarehouseCapacityInput): number {
  const { capacitySqFt, balesDivisionSqFt } = capacity;
  if (capacitySqFt <= 0 || balesDivisionSqFt <= 0) return 0;
  return roundCapacityMt(capacitySqFt / balesDivisionSqFt);
}

/**
 * Sq ft consumed by on-hand stock (grain + baled goods share the same floor).
 * Both stockMt and stockBales are tonnages; each is multiplied by its own
 * sq ft/MT division factor.
 */
export function stockConsumptionSqFt(
  stock: WarehouseStockInput,
  capacity: WarehouseCapacityInput,
): number {
  const grain =
    stock.stockMt > 0 && capacity.grainDivisionSqFt > 0
      ? stock.stockMt * capacity.grainDivisionSqFt
      : 0;
  const bales =
    stock.stockBales > 0 && capacity.balesDivisionSqFt > 0
      ? stock.stockBales * capacity.balesDivisionSqFt
      : 0;
  return grain + bales;
}

export function remainingSqFt(
  stock: WarehouseStockInput,
  capacity: WarehouseCapacityInput,
): number {
  const { capacitySqFt } = capacity;
  if (capacitySqFt <= 0) return 0;
  return Math.max(capacitySqFt - stockConsumptionSqFt(stock, capacity), 0);
}

/** Current utilization %: ((bales * balesDiv) + (mt * grainDiv)) / SqFt */
export function utilizationPercent(
  stock: WarehouseStockInput,
  capacity: WarehouseCapacityInput,
): number {
  const { capacitySqFt } = capacity;
  if (capacitySqFt <= 0) return 0;
  return Math.min(stockConsumptionSqFt(stock, capacity) / capacitySqFt, 1.5);
}

/**
 * Balance MT with bales on hand taking space:
 * AC - AD - (AA * X / Y)
 * i.e. theoreticalMaxMt - stockMt - baleEquivalentMt
 */
export function balanceCapacityMt(
  stock: WarehouseStockInput,
  capacity: WarehouseCapacityInput,
): number {
  const est = estimatedCapacityMt(capacity);
  const { grainDivisionSqFt, balesDivisionSqFt } = capacity;
  if (grainDivisionSqFt <= 0) return 0;

  const baleEquivalentMt =
    stock.stockBales > 0 && balesDivisionSqFt > 0
      ? (stock.stockBales * balesDivisionSqFt) / grainDivisionSqFt
      : 0;

  const balance = est - Math.max(stock.stockMt, 0) - baleEquivalentMt;
  return balance <= 0 ? 0 : balance;
}

/**
 * Balance bales with grain on hand taking space:
 * Z - AA - (AD * Y / X)
 * i.e. theoreticalMaxBales - stockBales - grainEquivalentBales
 */
export function balanceCapacityBales(
  stock: WarehouseStockInput,
  capacity: WarehouseCapacityInput,
): number {
  const est = estimatedCapacityBales(capacity);
  const { grainDivisionSqFt, balesDivisionSqFt } = capacity;
  if (balesDivisionSqFt <= 0) return 0;

  const grainEquivalentBales =
    stock.stockMt > 0 && grainDivisionSqFt > 0
      ? (stock.stockMt * grainDivisionSqFt) / balesDivisionSqFt
      : 0;

  const balance = est - Math.max(stock.stockBales, 0) - grainEquivalentBales;
  return balance <= 0 ? 0 : balance;
}

export function warehouseUtilizationSummary(
  stock: WarehouseStockInput,
  capacity: WarehouseCapacityInput,
): WarehouseUtilizationSummary {
  const consumedSqFt = stockConsumptionSqFt(stock, capacity);
  return {
    consumedSqFt,
    remainingSqFt: remainingSqFt(stock, capacity),
    utilizationPct: utilizationPercent(stock, capacity),
    theoreticalMaxMt: estimatedCapacityMt(capacity),
    theoreticalMaxBales: estimatedCapacityBales(capacity),
    balanceMt: balanceCapacityMt(stock, capacity),
    balanceBales: balanceCapacityBales(stock, capacity),
  };
}

/** Convert a free baled-MT balance to the grain-MT floor equivalent. */
export function baleBalanceAsGrainMt(
  balanceBales: number,
  capacity: Pick<WarehouseCapacityInput, "balesDivisionSqFt" | "grainDivisionSqFt">,
): number {
  if (balanceBales <= 0 || capacity.grainDivisionSqFt <= 0 || capacity.balesDivisionSqFt <= 0) {
    return 0;
  }
  return (balanceBales * capacity.balesDivisionSqFt) / capacity.grainDivisionSqFt;
}

/** Unified view for execution utilization + trader booking (same formulas). */
export type WarehouseUtilizationView = {
  grainDivisionSqFt: number;
  balesDivisionSqFt: number;
  capacitySqFt: number;
  stockMt: number;
  stockBales: number;
  utilizationPct: number;
  availabilityPct: number;
  remainingSqFt: number;
  consumedSqFt: number;
  theoreticalMaxMt: number;
  theoreticalMaxBales: number;
  /** Free room if storing grain (uses grain division sq ft / MT). */
  availableGrainMt: number;
  /** Free bale balance expressed as grain MT (bales division → grain division). */
  availableBaleAsGrainMt: number;
  /** Raw bale slots still free (for reference). */
  balanceBales: number;
  /** % of theoretical grain capacity (MT) still free — uses grain division only. */
  grainAvailabilityPct: number | null;
  /** % of theoretical bale capacity still free — uses bale division only. */
  baleAvailabilityPct: number | null;
};

export function buildWarehouseUtilizationView(
  loc: {
    capacitySqFt?: number | null;
    balesDivisionSqFt?: number | null;
    grainDivisionSqFt?: number | null;
  },
  stock: WarehouseStockInput,
): WarehouseUtilizationView | null {
  const capacitySqFt = loc.capacitySqFt ?? 0;
  if (capacitySqFt <= 0) return null;

  const capacity: WarehouseCapacityInput = {
    capacitySqFt,
    balesDivisionSqFt: loc.balesDivisionSqFt ?? 4.5,
    grainDivisionSqFt: loc.grainDivisionSqFt ?? 7,
  };
  const util = warehouseUtilizationSummary(stock, capacity);
  const usedPct = Math.min(util.utilizationPct, 1) * 100;

  return {
    grainDivisionSqFt: capacity.grainDivisionSqFt,
    balesDivisionSqFt: capacity.balesDivisionSqFt,
    capacitySqFt,
    stockMt: stock.stockMt,
    stockBales: stock.stockBales,
    utilizationPct: Math.round(usedPct * 10) / 10,
    availabilityPct: Math.round(Math.max(0, 100 - usedPct) * 10) / 10,
    remainingSqFt: util.remainingSqFt,
    consumedSqFt: util.consumedSqFt,
    theoreticalMaxMt: util.theoreticalMaxMt,
    theoreticalMaxBales: util.theoreticalMaxBales,
    availableGrainMt: util.balanceMt,
    availableBaleAsGrainMt: baleBalanceAsGrainMt(util.balanceBales, capacity),
    balanceBales: util.balanceBales,
    grainAvailabilityPct: divisionAvailabilityPct(util.balanceMt, util.theoreticalMaxMt),
    baleAvailabilityPct: divisionAvailabilityPct(util.balanceBales, util.theoreticalMaxBales),
  };
}

/** Commodities stored/count in bales rather than grain MT buckets. */
export function isBaleCommodity(commodityCode: string, quantityUnit?: string): boolean {
  const code = commodityCode.trim().toUpperCase();
  const unit = (quantityUnit ?? "").trim().toUpperCase();
  if (unit === "BALE" || unit === "BAG") return true;
  return ["CTN", "COT", "COTTON", "AFC"].includes(code);
}

export type WarehouseStorageDivision = "grain" | "bale";

/** Which warehouse floor division applies when storing this commodity. */
export function warehouseStorageDivisionForCommodity(input: {
  commodityCode?: string | null;
  quantityUnit?: string | null;
  category?: string | null;
}): WarehouseStorageDivision {
  const code = input.commodityCode ?? "";
  const unit = input.quantityUnit ?? "MT";
  if (isBaleCommodity(code, unit)) return "bale";
  if (input.category === "GRAINS" || input.category === "OILSEEDS") return "grain";
  if (isGrainCommodityCode(code)) return "grain";
  return "grain";
}

function divisionAvailabilityPct(available: number, theoreticalMax: number): number | null {
  if (theoreticalMax <= 0 || !Number.isFinite(theoreticalMax)) return null;
  return Math.round(Math.max(0, (available / theoreticalMax) * 100) * 10) / 10;
}

/** Pick availability % and free MT for the commodity's warehouse division. */
export function warehouseCapacityForDivision(
  view: Pick<
    WarehouseUtilizationView,
    | "grainAvailabilityPct"
    | "baleAvailabilityPct"
    | "availableGrainMt"
    | "availableBaleAsGrainMt"
    | "balanceBales"
    | "theoreticalMaxBales"
  >,
  division: WarehouseStorageDivision,
): { availabilityPct: number | null; availableMt: number | null; label: string } {
  if (division === "bale") {
    return {
      // Bales division is now sq ft/MT, so free capacity is a baled tonnage
      // in the commodity's own MT — parallel to grain, no cross-conversion.
      availabilityPct: view.baleAvailabilityPct,
      availableMt: view.balanceBales,
      label: "bale division",
    };
  }
  return {
    availabilityPct: view.grainAvailabilityPct,
    availableMt: view.availableGrainMt,
    label: "grain division",
  };
}

export function stockFromMovement(
  commodityCode: string,
  quantityUnit: string,
  netQty: number,
): WarehouseStockInput {
  if (isBaleCommodity(commodityCode, quantityUnit)) {
    return { stockMt: 0, stockBales: Math.max(netQty, 0) };
  }
  const mt =
    quantityUnit.toUpperCase() === "MT" || quantityUnit.toUpperCase() === "TON"
      ? netQty
      : kgToMt(netQty);
  return { stockMt: Math.max(mt, 0), stockBales: 0 };
}

export function aggregateWarehouseStock(
  rows: { commodityCode: string; quantityUnit: string; netQty: number }[],
): WarehouseStockInput {
  return rows.reduce<WarehouseStockInput>(
    (acc, row) => {
      const part = stockFromMovement(row.commodityCode, row.quantityUnit, row.netQty);
      return {
        stockMt: acc.stockMt + part.stockMt,
        stockBales: acc.stockBales + part.stockBales,
      };
    },
    { stockMt: 0, stockBales: 0 },
  );
}
