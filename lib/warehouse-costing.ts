/** Pakistani maund = 40 kg */
export const KG_PER_MAUND = 40;
export const MAUND_PER_MT = 1000 / KG_PER_MAUND;

export type WarehouseLaborLine = {
  role: string;
  headcount: number;
  unitCostPkr: number;
};

export type WarehouseCostingInput = {
  capacitySqFt?: number | null;
  grainDivisionSqFt?: number | null;
  rentalPerSqFtMonth?: number | null;
  rentalTaxPkr?: number | null;
  laborLines?: WarehouseLaborLine[] | null;
  managementFeePct?: number | null;
};

export type WarehouseCostingSummary = {
  squareFeet: number;
  totalRentCostPkr: number;
  totalLaborCostPkr: number;
  totalLaborHeadcount: number;
  totalRunningCostPkr: number;
  managementFeePct: number;
  managementFeePkr: number;
  totalCostPkr: number;
  loadedCostPerSqFtPkr: number;
  storageCapacityMt: number;
  storageAt70PctMt: number;
  costPerMaundAt70PctPkr: number;
  costPerMaundAt100PctPkr: number;
};

export const DEFAULT_WAREHOUSE_LABOR: WarehouseLaborLine[] = [
  { role: "Warehouse Supervisor", headcount: 1, unitCostPkr: 60_000 },
  { role: "Asst. Supervisor", headcount: 1, unitCostPkr: 40_000 },
  { role: "Security Guards", headcount: 4, unitCostPkr: 52_200 },
  { role: "Sweeper", headcount: 0, unitCostPkr: 0 },
];

export function normalizeLaborLines(lines?: WarehouseLaborLine[] | null): WarehouseLaborLine[] {
  if (!lines?.length) return DEFAULT_WAREHOUSE_LABOR.map((l) => ({ ...l }));
  return lines.map((l) => ({
    role: l.role.trim() || "Role",
    headcount: Math.max(0, Number(l.headcount) || 0),
    unitCostPkr: Math.max(0, Number(l.unitCostPkr) || 0),
  }));
}

export function computeWarehouseCosting(input: WarehouseCostingInput): WarehouseCostingSummary | null {
  const squareFeet = input.capacitySqFt ?? 0;
  if (squareFeet <= 0) return null;

  const rentalRate = input.rentalPerSqFtMonth ?? 0;
  const rentalTax = input.rentalTaxPkr ?? 0;
  const totalRentCostPkr = squareFeet * rentalRate + rentalTax;

  const laborLines = normalizeLaborLines(input.laborLines);
  let totalLaborCostPkr = 0;
  let totalLaborHeadcount = 0;
  for (const line of laborLines) {
    totalLaborCostPkr += line.headcount * line.unitCostPkr;
    totalLaborHeadcount += line.headcount;
  }

  const totalRunningCostPkr = totalRentCostPkr + totalLaborCostPkr;
  const managementFeePct = input.managementFeePct ?? 0;
  const managementFeePkr = totalRunningCostPkr * (managementFeePct / 100);
  const totalCostPkr = totalRunningCostPkr + managementFeePkr;
  const loadedCostPerSqFtPkr = totalCostPkr / squareFeet;

  const grainDiv = input.grainDivisionSqFt && input.grainDivisionSqFt > 0 ? input.grainDivisionSqFt : 7;
  const storageCapacityMt = squareFeet / grainDiv;
  const storageAt70PctMt = storageCapacityMt * 0.7;
  const maundsAt100 = storageCapacityMt * MAUND_PER_MT;
  const maundsAt70 = storageAt70PctMt * MAUND_PER_MT;
  const costPerMaundAt100PctPkr = maundsAt100 > 0 ? totalCostPkr / maundsAt100 : 0;
  const costPerMaundAt70PctPkr = maundsAt70 > 0 ? totalCostPkr / maundsAt70 : 0;

  return {
    squareFeet,
    totalRentCostPkr,
    totalLaborCostPkr,
    totalLaborHeadcount,
    totalRunningCostPkr,
    managementFeePct,
    managementFeePkr,
    totalCostPkr,
    loadedCostPerSqFtPkr,
    storageCapacityMt,
    storageAt70PctMt,
    costPerMaundAt70PctPkr,
    costPerMaundAt100PctPkr,
  };
}

export function fmtPkr(n: number, decimals = 0) {
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(n);
}

export function costingInputFromLocation(loc: {
  capacitySqFt?: number | null;
  costPerSqFt?: number | null;
  rentalPerSqFtMonth?: number | null;
  grainDivisionSqFt?: number | null;
  rentalTaxPkr?: number | null;
  laborLines?: WarehouseLaborLine[] | null;
  managementFeePct?: number | null;
}): WarehouseCostingInput {
  return {
    capacitySqFt: loc.capacitySqFt,
    grainDivisionSqFt: loc.grainDivisionSqFt,
    rentalPerSqFtMonth: loc.rentalPerSqFtMonth ?? loc.costPerSqFt,
    rentalTaxPkr: loc.rentalTaxPkr,
    laborLines: loc.laborLines,
    managementFeePct: loc.managementFeePct,
  };
}

function asNumber(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Derive storage metrics from a warehouse create/edit change-request payload. */
export function storageMetricsFromWarehousePayload(
  payload: Record<string, unknown>,
): WarehouseCostingSummary | null {
  return computeWarehouseCosting({
    capacitySqFt: asNumber(payload.capacitySqFt),
    grainDivisionSqFt: asNumber(payload.grainDivisionSqFt) || 7,
    rentalPerSqFtMonth: asNumber(payload.costPerSqFt),
    rentalTaxPkr: asNumber(payload.rentalTaxPkr),
    laborLines: Array.isArray(payload.laborLines)
      ? (payload.laborLines as WarehouseLaborLine[])
      : undefined,
    managementFeePct: asNumber(payload.managementFeePct),
  });
}

export function fmtStorageMt(n: number) {
  return new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(Math.round(n));
}

export function fmtCostPerMaund(n: number) {
  return new Intl.NumberFormat("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** Network-wide storage totals across all warehouses. */
export function aggregateWarehouseStorageMetrics(
  summaries: WarehouseCostingSummary[],
): WarehouseCostingSummary | null {
  if (!summaries.length) return null;

  const storageCapacityMt = summaries.reduce((s, x) => s + x.storageCapacityMt, 0);
  const storageAt70PctMt = summaries.reduce((s, x) => s + x.storageAt70PctMt, 0);
  const totalCostPkr = summaries.reduce((s, x) => s + x.totalCostPkr, 0);
  const squareFeet = summaries.reduce((s, x) => s + x.squareFeet, 0);
  const maundsAt100 = storageCapacityMt * MAUND_PER_MT;
  const maundsAt70 = storageAt70PctMt * MAUND_PER_MT;

  return {
    squareFeet,
    totalRentCostPkr: summaries.reduce((s, x) => s + x.totalRentCostPkr, 0),
    totalLaborCostPkr: summaries.reduce((s, x) => s + x.totalLaborCostPkr, 0),
    totalLaborHeadcount: summaries.reduce((s, x) => s + x.totalLaborHeadcount, 0),
    totalRunningCostPkr: summaries.reduce((s, x) => s + x.totalRunningCostPkr, 0),
    managementFeePct: 0,
    managementFeePkr: summaries.reduce((s, x) => s + x.managementFeePkr, 0),
    totalCostPkr,
    loadedCostPerSqFtPkr: squareFeet > 0 ? totalCostPkr / squareFeet : 0,
    storageCapacityMt,
    storageAt70PctMt,
    costPerMaundAt100PctPkr: maundsAt100 > 0 ? totalCostPkr / maundsAt100 : 0,
    costPerMaundAt70PctPkr: maundsAt70 > 0 ? totalCostPkr / maundsAt70 : 0,
  };
}
