import { CommodityCategory, CounterpartyType } from "@prisma/client";
import { DEFAULT_GRADES, INCOTERMS, incotermsForDirection, QUANTITY_UNITS, isCornCommodity, isGrainCommodityCode } from "@/lib/trade-constants";
import { defaultCategoryForCommodityCode } from "@/lib/commodity-category";
import type { KycStatus } from "@/lib/trade-constants";
import type { TradeParamDefinition } from "@/lib/trade-parameters";
import {
  canonicalKgPerUnitOf,
  PRICE_CURRENCIES,
  PRICE_WEIGHT_UNITS,
  resolvePriceBasis,
  type CommodityPriceUnits,
  type PriceBasis,
} from "@/lib/price-units";
import { mergeUnitRegistry, type UnitDefinition } from "@/lib/unit-registry";
import type { WarehouseLaborLine } from "@/lib/warehouse-costing";
import {
  isLocalPersistEnabled,
  MASTER_DATA_FILE,
  readPersisted,
  writePersisted,
} from "@/server/local-persist";

export type MockCommodityOption = {
  id: string;
  name: string;
  code: string;
  /** Canonical quantity unit used throughout the app (default MT). */
  unit: string;
  exchange: string | null;
  tickerCode: string | null;
  category: CommodityCategory;
  /** Kilograms per one canonical quantity unit (e.g. MT → 1000). Derived from `unit` if omitted. */
  canonicalKgPerUnit?: number | null;
  /** How this commodity is priced in each market. Falls back to canonical unit if omitted. */
  priceUnits?: CommodityPriceUnits | null;
  /** Extra booking fields specific to this commodity (merged with global + template params). */
  tradeParameterDefs?: TradeParamDefinition[] | null;
};

export type MockCounterpartyOption = {
  id: string;
  name: string;
  code: string;
  type: CounterpartyType;
  country: string;
  kycStatus: KycStatus;
  kycRef: string | null;
  kycExpires: Date | null;
  /** Legal company name as registered on NTN */
  companyNameNtn: string | null;
  ntn: string | null;
  address: string | null;
  bankDetails: string | null;
};

export type MockLocationOption = {
  id: string;
  name: string;
  code?: string | null;
  lsp?: string | null;
  address?: string | null;
  city?: string | null;
  province?: string | null;
  capacitySqFt?: number | null;
  costPerSqFt?: number | null;
  balesDivisionSqFt?: number | null;
  grainDivisionSqFt?: number | null;
  /** Warehousing service agreement start (ISO date). */
  serviceStartDate?: string | null;
  /** Estimated monthly tax on rental (PKR). */
  rentalTaxPkr?: number | null;
  /** Management fee as percentage of running cost. */
  managementFeePct?: number | null;
  /** Fixed hire period in months. */
  hiringPeriodMonths?: number | null;
  /** Fixed labor roles with headcount and monthly unit cost. */
  laborLines?: WarehouseLaborLine[] | null;
};

const SEEDED_COMMODITIES: MockCommodityOption[] = [];

const SEEDED_COUNTERPARTIES: MockCounterpartyOption[] = [];

const SEEDED_LOCATIONS: MockLocationOption[] = [];

type MasterDataSnapshot = {
  customCommodities: MockCommodityOption[];
  customGrades: Record<string, string[]>;
  customLocations: MockLocationOption[];
  customCounterparties: MockCounterpartyOption[];
  customCommoditySeq: number;
  customLocationSeq: number;
  customCounterpartySeq: number;
  customQuantityUnits?: string[];
  /** Custom units with kg conversion factors (replaces bare string list over time). */
  customUnits?: UnitDefinition[];
  warehouseOverrides?: Record<string, Partial<MockLocationOption>>;
};

type MasterRuntime = MasterDataSnapshot;

const MASTER_RUNTIME_KEY = "__kastrosMasterRuntime";

function getMasterRuntime(): MasterRuntime {
  const g = globalThis as typeof globalThis & {
    [MASTER_RUNTIME_KEY]?: MasterRuntime;
  };
  if (!g[MASTER_RUNTIME_KEY]) {
    g[MASTER_RUNTIME_KEY] = {
      customCommodities: [],
      customGrades: {},
      customLocations: [],
      customCounterparties: [],
      customCommoditySeq: 100,
      customLocationSeq: 100,
      customCounterpartySeq: 100,
      customQuantityUnits: [],
      customUnits: [],
      warehouseOverrides: {},
    };
  }
  return g[MASTER_RUNTIME_KEY];
}

function syncMasterDataFromDisk() {
  if (!isLocalPersistEnabled()) return;
  const snap = readPersisted<MasterDataSnapshot>(MASTER_DATA_FILE);
  if (!snap) return;
  const rt = getMasterRuntime();
  rt.customCommodities.length = 0;
  rt.customCommodities.push(...snap.customCommodities);
  rt.customGrades = { ...snap.customGrades };
  rt.customLocations.length = 0;
  rt.customLocations.push(...snap.customLocations);
  rt.customCounterparties.length = 0;
  rt.customCounterparties.push(...snap.customCounterparties);
  rt.customCommoditySeq = snap.customCommoditySeq;
  rt.customLocationSeq = snap.customLocationSeq;
  rt.customCounterpartySeq = snap.customCounterpartySeq;
  rt.customQuantityUnits = snap.customQuantityUnits ?? [];
  rt.customUnits = snap.customUnits ?? [];
  rt.warehouseOverrides = snap.warehouseOverrides ?? {};
}

function persistMasterData() {
  const rt = getMasterRuntime();
  writePersisted(MASTER_DATA_FILE, {
    customCommodities: rt.customCommodities,
    customGrades: rt.customGrades,
    customLocations: rt.customLocations,
    customCounterparties: rt.customCounterparties,
    customCommoditySeq: rt.customCommoditySeq,
    customLocationSeq: rt.customLocationSeq,
    customCounterpartySeq: rt.customCounterpartySeq,
    customQuantityUnits: rt.customQuantityUnits ?? [],
    customUnits: rt.customUnits ?? [],
    warehouseOverrides: rt.warehouseOverrides ?? {},
  } satisfies MasterDataSnapshot);
}

function masterRt() {
  syncMasterDataFromDisk();
  const rt = getMasterRuntime();
  ensureCounterpartyCodes(rt);
  ensureCommodityCategories(rt);
  return rt;
}

function norm(s: string) {
  return s.trim().toLowerCase();
}

/** Unique counterparty business key, e.g. CP-00101 */
export function formatCounterpartyCode(seq: number): string {
  return `CP-${String(seq).padStart(5, "0")}`;
}

function getMergedCounterpartiesFromRt(rt: MasterRuntime): MockCounterpartyOption[] {
  return [...SEEDED_COUNTERPARTIES, ...rt.customCounterparties];
}

function nextCounterpartyCode(rt: MasterRuntime): string {
  const existing = new Set(getMergedCounterpartiesFromRt(rt).map((c) => norm(c.code)));
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    rt.customCounterpartySeq += 1;
    const code = formatCounterpartyCode(rt.customCounterpartySeq);
    if (!existing.has(norm(code))) return code;
  }
  throw new Error("Could not allocate a unique counterparty code");
}

/** Assign backend codes to legacy counterparties that used name slugs. */
function ensureCounterpartyCodes(rt: MasterRuntime) {
  let changed = false;
  for (const cp of rt.customCounterparties) {
    if (/^CP-\d{5}$/i.test(cp.code)) continue;
    cp.code = nextCounterpartyCode(rt);
    changed = true;
  }
  if (changed) persistMasterData();
}

/** Persist grain category for corn and other grain codes (warehouse grain division). */
function ensureCommodityCategories(rt: MasterRuntime) {
  let changed = false;
  for (const row of rt.customCommodities) {
    const shouldBeGrain = isCornCommodity(row.code) || isGrainCommodityCode(row.code);
    if (shouldBeGrain && row.category !== CommodityCategory.GRAINS) {
      row.category = CommodityCategory.GRAINS;
      changed = true;
    }
  }
  if (changed) persistMasterData();
}

export { defaultCategoryForCommodityCode } from "@/lib/commodity-category";

function uniqueUnits(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const unit = value.trim();
    const key = norm(unit);
    if (!unit || seen.has(key)) continue;
    seen.add(key);
    out.push(unit);
  }

  return out;
}

function mergedQuantityUnits(rt = masterRt()) {
  const fromRegistry = [...getMergedUnitRegistry(rt).values()].map((u) => u.code);
  return uniqueUnits([
    ...QUANTITY_UNITS,
    ...fromRegistry,
    ...SEEDED_COMMODITIES.map((c) => c.unit),
    ...rt.customCommodities.map((c) => c.unit),
    ...((rt.customQuantityUnits) ?? []),
  ]);
}

/** All known units with kg-per-unit factors (built-in + custom). */
export function getMergedUnitRegistry(rt = masterRt()): Map<string, UnitDefinition> {
  return mergeUnitRegistry(rt.customUnits ?? []);
}

/** Register or update a custom unit's kg conversion factor. */
export function registerCustomUnit(input: { code: string; kgPerUnit: number; label?: string }) {
  const code = input.code.trim().toUpperCase();
  if (!code || input.kgPerUnit <= 0) throw new Error("Unit code and positive kg per unit are required");
  const rt = getMasterRuntime();
  rt.customUnits = rt.customUnits ?? [];
  const idx = rt.customUnits.findIndex((u) => norm(u.code) === norm(code));
  const row: UnitDefinition = { code, kgPerUnit: input.kgPerUnit, label: input.label };
  if (idx >= 0) rt.customUnits[idx] = row;
  else rt.customUnits.push(row);
  // Keep legacy string list in sync for older dropdowns
  rt.customQuantityUnits = rt.customQuantityUnits ?? [];
  if (!rt.customQuantityUnits.map(norm).includes(norm(code))) {
    rt.customQuantityUnits.push(code);
  }
  persistMasterData();
  return row;
}

function canonicalUnit(unit: string, rt: MasterRuntime) {
  const key = norm(unit);
  return mergedQuantityUnits(rt).find((known) => norm(known) === key) ?? unit.trim();
}

export function getMergedCommodities(): MockCommodityOption[] {
  const rt = masterRt();
  return [...SEEDED_COMMODITIES, ...rt.customCommodities];
}

export function getCommodityById(id: string): MockCommodityOption | undefined {
  return getMergedCommodities().find((c) => c.id === id);
}

export function getMergedCounterparties(): MockCounterpartyOption[] {
  return getMergedCounterpartiesFromRt(masterRt());
}

export function getCounterpartyById(id: string): MockCounterpartyOption | undefined {
  return getMergedCounterparties().find((c) => c.id === id);
}

export function getMergedLocations(): MockLocationOption[] {
  const rt = masterRt();
  const seen = new Set<string>();
  const out: MockLocationOption[] = [];
  const overrides = rt.warehouseOverrides ?? {};
  for (const loc of [...SEEDED_LOCATIONS, ...rt.customLocations]) {
    const k = norm(loc.name);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ...loc, ...(overrides[loc.id] ?? {}) });
  }
  return out;
}

export function getLocationByName(name: string): MockLocationOption | undefined {
  const key = norm(name);
  return getMergedLocations().find((l) => norm(l.name) === key);
}

/** True for the company's own storage warehouses (have capacity or a K-coded id) vs. ports/FOB points. */
export function isCompanyWarehouse(loc: MockLocationOption): boolean {
  return loc.capacitySqFt != null || (loc.code?.trim().toUpperCase().startsWith("K") ?? false);
}

/** Company-owned warehouses the execution head can allocate contracts to. */
export function getCompanyWarehouses(): MockLocationOption[] {
  return getMergedLocations().filter(isCompanyWarehouse);
}

export function getMergedGrades(): Record<string, string[]> {
  const rt = masterRt();
  const merged: Record<string, string[]> = {};
  for (const [code, grades] of Object.entries(DEFAULT_GRADES)) {
    merged[code] = [...grades];
  }
  for (const [code, extras] of Object.entries(rt.customGrades)) {
    const base = merged[code] ?? [...(DEFAULT_GRADES.default ?? [])];
    const seen = new Set(base.map(norm));
    for (const g of extras) {
      if (!seen.has(norm(g))) {
        base.push(g);
        seen.add(norm(g));
      }
    }
    merged[code] = base;
  }
  return merged;
}

export function getGradesForCommodity(code: string): string[] {
  const all = getMergedGrades();
  return all[code] ?? all.default ?? [];
}

export function getTraderReferenceData() {
  const rt = masterRt();

  return {
    commodities: getMergedCommodities(),
    counterparties: getMergedCounterparties(),
    locations: getMergedLocations(),
    incoterms: [...INCOTERMS],
    incotermsByDirection: {
      BUY: [...incotermsForDirection("BUY")],
      SELL: [...incotermsForDirection("SELL")],
    },
    quantityUnits: mergedQuantityUnits(rt),
    units: [...getMergedUnitRegistry(rt).values()].sort((a, b) => a.code.localeCompare(b.code)),
    priceCurrencies: [...PRICE_CURRENCIES],
    priceWeightUnits: uniqueUnits([...PRICE_WEIGHT_UNITS, ...mergedQuantityUnits(rt)]),
    grades: getMergedGrades(),
    /** Company warehouses registered on Execution → Warehouses (for booking dropdown). */
    companyWarehouses: getCompanyWarehouses().map((w) => ({
      id: w.id,
      name: w.name,
      code: w.code ?? null,
    })),
  };
}

/** Resolve the price basis for a commodity id + market scope (server-side). */
export function getCommodityPriceBasis(
  commodityId: string,
  scope: "LOCAL" | "INTERNATIONAL",
): PriceBasis {
  return resolvePriceBasis(getCommodityById(commodityId), scope);
}

export function addCustomCommodity(input: {
  name: string;
  code: string;
  unit: string;
  category?: CommodityCategory;
  canonicalKgPerUnit?: number | null;
  priceUnits?: CommodityPriceUnits | null;
  tradeParameterDefs?: TradeParamDefinition[] | null;
}) {
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  const unitInput = input.unit.trim();
  if (!code || !name || !unitInput) throw new Error("Name, code, and unit are required");
  if (getMergedCommodities().some((c) => norm(c.code) === norm(code))) {
    throw new Error(`Commodity code ${code} already exists`);
  }
  const rt = getMasterRuntime();
  const unit = canonicalUnit(unitInput, rt);
  const kgPerCanonical =
    input.canonicalKgPerUnit ?? canonicalKgPerUnitOf({ unit });
  registerCustomUnit({ code: unit, kgPerUnit: kgPerCanonical });
  rt.customCommoditySeq += 1;
  const row: MockCommodityOption = {
    id: `cc-${rt.customCommoditySeq}`,
    name,
    code,
    unit,
    exchange: null,
    tickerCode: null,
    category: input.category ?? defaultCategoryForCommodityCode(code),
    canonicalKgPerUnit: kgPerCanonical,
    priceUnits: input.priceUnits ?? null,
    tradeParameterDefs: input.tradeParameterDefs ?? null,
  };
  rt.customCommodities.push(row);
  // If commodity unit is new, persist it so dropdowns include it
  const unitNorm = norm(unit);
  rt.customQuantityUnits = rt.customQuantityUnits ?? [];
  if (!QUANTITY_UNITS.map(norm).includes(unitNorm) && !rt.customQuantityUnits.map(norm).includes(unitNorm)) {
    rt.customQuantityUnits.push(unit);
  }
  persistMasterData();
  return row;
}

export function deleteCustomCommodity(id: string): { ok: boolean; code: string; name: string } {
  const rt = masterRt();
  const idx = rt.customCommodities.findIndex((c) => c.id === id);
  if (idx < 0) {
    throw new Error("Commodity not found or cannot be deleted");
  }
  const row = rt.customCommodities[idx]!;
  rt.customCommodities.splice(idx, 1);
  persistMasterData();
  return { ok: true, code: row.code, name: row.name };
}

export function addCustomGrade(commodityCode: string, grade: string) {
  const rt = getMasterRuntime();
  const code = commodityCode.trim().toUpperCase();
  const g = grade.trim();
  if (!code || !g) throw new Error("Commodity code and grade are required");
  const existing = rt.customGrades[code] ?? [];
  if (existing.some((x) => norm(x) === norm(g)) || getGradesForCommodity(code).some((x) => norm(x) === norm(g))) {
    throw new Error("Grade already exists");
  }
  rt.customGrades[code] = [...existing, g];
  persistMasterData();
  return g;
}

export function addCustomLocation(input: {
  name: string;
  code?: string;
  lsp?: string;
  address?: string;
  city?: string;
  province?: string;
  capacitySqFt?: number;
  costPerSqFt?: number;
  balesDivisionSqFt?: number;
  grainDivisionSqFt?: number;
  serviceStartDate?: string;
  rentalTaxPkr?: number;
  managementFeePct?: number;
  hiringPeriodMonths?: number;
  laborLines?: WarehouseLaborLine[];
}) {
  const rt = getMasterRuntime();
  const n = input.name.trim();
  if (!n) throw new Error("Location name is required");
  if (getMergedLocations().some((l) => norm(l.name) === norm(n))) {
    throw new Error("Location already exists");
  }
  rt.customLocationSeq += 1;
  const row: MockLocationOption = {
    id: `cl-${rt.customLocationSeq}`,
    name: n,
    code: input.code?.trim() || null,
    lsp: input.lsp?.trim() || null,
    address: input.address?.trim() || null,
    city: input.city?.trim() || null,
    province: input.province?.trim() || null,
    capacitySqFt: input.capacitySqFt ?? null,
    costPerSqFt: input.costPerSqFt ?? null,
    balesDivisionSqFt: input.balesDivisionSqFt ?? 4.5,
    grainDivisionSqFt: input.grainDivisionSqFt ?? 7,
    serviceStartDate: input.serviceStartDate?.trim() || null,
    rentalTaxPkr: input.rentalTaxPkr ?? null,
    managementFeePct: input.managementFeePct ?? null,
    hiringPeriodMonths: input.hiringPeriodMonths ?? null,
    laborLines: input.laborLines?.length ? input.laborLines : null,
  };
  rt.customLocations.push(row);
  persistMasterData();
  return row;
}

export function updateWarehouseLocation(
  id: string,
  patch: Partial<Omit<MockLocationOption, "id">>,
) {
  const rt = getMasterRuntime();
  const existing =
    [...SEEDED_LOCATIONS, ...rt.customLocations].find((l) => l.id === id) ??
  null;
  if (!existing) throw new Error("Warehouse not found");

  const isCustom = rt.customLocations.some((l) => l.id === id);
  if (isCustom) {
    const idx = rt.customLocations.findIndex((l) => l.id === id);
    rt.customLocations[idx] = { ...rt.customLocations[idx], ...patch, id };
  } else {
    if (!rt.warehouseOverrides) rt.warehouseOverrides = {};
    rt.warehouseOverrides[id] = { ...(rt.warehouseOverrides[id] ?? {}), ...patch };
  }
  persistMasterData();
  return getMergedLocations().find((l) => l.id === id)!;
}

export function deleteWarehouseLocation(id: string): { ok: boolean; name: string } {
  const rt = getMasterRuntime();
  const idx = rt.customLocations.findIndex((l) => l.id === id);
  if (idx < 0) {
    throw new Error("Only custom warehouses can be deleted. Seeded warehouses cannot be removed.");
  }
  const name = rt.customLocations[idx]!.name;
  rt.customLocations.splice(idx, 1);
  persistMasterData();
  return { ok: true, name };
}

export function addCustomCounterparty(input: {
  name: string;
  code?: string;
  type?: CounterpartyType;
  country: string;
  kycStatus?: KycStatus;
  kycRef?: string | null;
  kycExpires?: Date | null;
  companyNameNtn?: string | null;
  ntn?: string | null;
  address?: string | null;
  bankDetails?: string | null;
}) {
  const name = input.name.trim();
  if (!name) throw new Error("Name is required");
  const rt = getMasterRuntime();
  let code: string;
  if (input.code?.trim()) {
    code = input.code.trim().toUpperCase();
    if (getMergedCounterpartiesFromRt(rt).some((c) => norm(c.code) === norm(code))) {
      throw new Error(`Counterparty code ${code} already exists`);
    }
    rt.customCounterpartySeq += 1;
  } else {
    code = nextCounterpartyCode(rt);
  }
  const row: MockCounterpartyOption = {
    id: `ccp-${rt.customCounterpartySeq}`,
    name,
    code,
    type: input.type ?? CounterpartyType.TRADING_PARTNER,
    country: input.country.trim(),
    kycStatus: input.kycStatus ?? "PENDING",
    kycRef: input.kycRef?.trim() || null,
    kycExpires: input.kycExpires ?? null,
    companyNameNtn: input.companyNameNtn?.trim() || null,
    ntn: input.ntn?.trim() || null,
    address: input.address?.trim() || null,
    bankDetails: input.bankDetails?.trim() || null,
  };
  rt.customCounterparties.push(row);
  persistMasterData();
  return row;
}

export function updateCustomCounterparty(
  id: string,
  patch: Partial<
    Pick<
      MockCounterpartyOption,
      | "name"
      | "type"
      | "country"
      | "kycStatus"
      | "kycRef"
      | "kycExpires"
      | "companyNameNtn"
      | "ntn"
      | "address"
      | "bankDetails"
    >
  >,
): MockCounterpartyOption {
  syncMasterDataFromDisk();
  const rt = getMasterRuntime();
  const idx = rt.customCounterparties.findIndex((c) => c.id === id);
  if (idx < 0) {
    throw new Error("Counterparty not found or cannot be edited");
  }
  const row = rt.customCounterparties[idx]!;
  if (patch.name != null) {
    const name = patch.name.trim();
    if (!name) throw new Error("Counterparty name is required");
    row.name = name;
  }
  if (patch.type != null) row.type = patch.type;
  if (patch.country != null) row.country = patch.country.trim();
  if (patch.kycStatus != null) row.kycStatus = patch.kycStatus;
  if (patch.kycRef !== undefined) row.kycRef = patch.kycRef?.trim() || null;
  if (patch.kycExpires !== undefined) row.kycExpires = patch.kycExpires ?? null;
  if (patch.companyNameNtn !== undefined) row.companyNameNtn = patch.companyNameNtn?.trim() || null;
  if (patch.ntn !== undefined) row.ntn = patch.ntn?.trim() || null;
  if (patch.address !== undefined) row.address = patch.address?.trim() || null;
  if (patch.bankDetails !== undefined) row.bankDetails = patch.bankDetails?.trim() || null;
  rt.customCounterparties[idx] = row;
  persistMasterData();
  return row;
}
