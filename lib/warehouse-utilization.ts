/** Warehouse capacity & utilization — mirrors Inventory Sheet Summary tab formulas. */

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
  /** Theoretical max if the entire warehouse held only bales. */
  theoreticalMaxBales: number;
  /** Remaining room expressed as MT after accounting for bales on hand. */
  balanceMt: number;
  /** Remaining room expressed as bales after accounting for grain on hand. */
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

/** Theoretical bale-only capacity: ROUNDUP((SqFt / Bales Division) / 10, 0) * 10 */
export function estimatedCapacityBales(capacity: WarehouseCapacityInput): number {
  const { capacitySqFt, balesDivisionSqFt } = capacity;
  if (capacitySqFt <= 0 || balesDivisionSqFt <= 0) return 0;
  return roundCapacityBales(capacitySqFt / balesDivisionSqFt);
}

/** Sq ft consumed by on-hand stock (grain + bales share the same floor area). */
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

/** Commodities stored/count in bales rather than grain MT buckets. */
export function isBaleCommodity(commodityCode: string, quantityUnit?: string): boolean {
  const code = commodityCode.trim().toUpperCase();
  const unit = (quantityUnit ?? "").trim().toUpperCase();
  if (unit === "BALE" || unit === "BAG") return true;
  return ["CTN", "COT", "COTTON", "AFC"].includes(code);
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
