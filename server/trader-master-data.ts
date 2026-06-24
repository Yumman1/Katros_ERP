import { addDays } from "date-fns";
import { CommodityCategory, CounterpartyType } from "@prisma/client";
import { DEFAULT_GRADES, INCOTERMS, QUANTITY_UNITS } from "@/lib/trade-constants";
import type { KycStatus } from "@/lib/trade-constants";
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
  unit: string;
  exchange: string | null;
  tickerCode: string | null;
  category: CommodityCategory;
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

const CP_EXTRA_DEFAULT = {
  companyNameNtn: null,
  ntn: null,
  address: null,
  bankDetails: null,
} as const;

export type MockLocationOption = { id: string; name: string };

const SEEDED_COMMODITIES: MockCommodityOption[] = [
  { id: "c1", name: "Wheat", code: "WHT", unit: "MT", exchange: "CBOT", tickerCode: "ZW", category: CommodityCategory.GRAINS },
  { id: "c2", name: "Palm Oil", code: "CPO", unit: "MT", exchange: "BMD", tickerCode: "FCPO", category: CommodityCategory.VEGOIL },
  { id: "c3", name: "Sugar", code: "SUG", unit: "MT", exchange: "ICE", tickerCode: "SB", category: CommodityCategory.SOFTS },
  { id: "c6", name: "Soybeans", code: "SOY", unit: "MT", exchange: "CBOT", tickerCode: "ZS", category: CommodityCategory.OILSEEDS },
  { id: "c7", name: "Rice", code: "RCE", unit: "MT", exchange: "CBOT", tickerCode: "ZR", category: CommodityCategory.GRAINS },
];

const SEEDED_COUNTERPARTIES: MockCounterpartyOption[] = [
  { id: "cp1", name: "Sindh Mills Corp", code: "SMC", type: CounterpartyType.SELLER, country: "PK", kycStatus: "VERIFIED", kycRef: "KYC-SMC-2025", kycExpires: addDays(new Date(), 180), ...CP_EXTRA_DEFAULT },
  { id: "cp2", name: "Al Ghurair Resources", code: "AGR", type: CounterpartyType.SELLER, country: "AE", kycStatus: "VERIFIED", kycRef: "KYC-AGR-2024", kycExpires: addDays(new Date(), 90), ...CP_EXTRA_DEFAULT },
  { id: "cp3", name: "Cargill Grain Asia", code: "CGA", type: CounterpartyType.SELLER, country: "SG", kycStatus: "VERIFIED", kycRef: "KYC-CGA-2025", kycExpires: addDays(new Date(), 240), ...CP_EXTRA_DEFAULT },
  { id: "cp4", name: "Glencore Agri", code: "GLN", type: CounterpartyType.SELLER, country: "CH", kycStatus: "VERIFIED", kycRef: "KYC-GLN-2025", kycExpires: addDays(new Date(), 120), ...CP_EXTRA_DEFAULT },
  { id: "cp5", name: "Universal Corporation", code: "UNV", type: CounterpartyType.SELLER, country: "US", kycStatus: "VERIFIED", kycRef: "KYC-UNV-2024", kycExpires: addDays(new Date(), 60), ...CP_EXTRA_DEFAULT },
  { id: "cp6", name: "National Foods", code: "NAF", type: CounterpartyType.BUYER, country: "PK", kycStatus: "VERIFIED", kycRef: "KYC-NAF-2025", kycExpires: addDays(new Date(), 200), ...CP_EXTRA_DEFAULT },
  { id: "cp7", name: "Engro Grain Terminal", code: "EGT", type: CounterpartyType.BUYER, country: "PK", kycStatus: "PENDING", kycRef: null, kycExpires: null, ...CP_EXTRA_DEFAULT },
  { id: "cp8", name: "FFC Agricultural", code: "FFC", type: CounterpartyType.SELLER, country: "PK", kycStatus: "EXPIRED", kycRef: "KYC-FFC-2023", kycExpires: addDays(new Date(), -30), ...CP_EXTRA_DEFAULT },
];

const SEEDED_LOCATIONS: MockLocationOption[] = [
  { id: "l1", name: "Karachi Warehouse" },
  { id: "l2", name: "Lahore Warehouse" },
  { id: "l3", name: "Multan Silo Cluster" },
  { id: "l4", name: "Karachi Port" },
  { id: "l5", name: "Port Qasim" },
  { id: "l6", name: "Port Klang, Malaysia" },
  { id: "l7", name: "Santos, Brazil" },
  { id: "l8", name: "New Orleans, USA" },
  { id: "l9", name: "FOB Karachi" },
];

type MasterDataSnapshot = {
  customCommodities: MockCommodityOption[];
  customGrades: Record<string, string[]>;
  customLocations: MockLocationOption[];
  customCounterparties: MockCounterpartyOption[];
  customCommoditySeq: number;
  customLocationSeq: number;
  customCounterpartySeq: number;
  customQuantityUnits?: string[];
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
  } satisfies MasterDataSnapshot);
}

function masterRt() {
  syncMasterDataFromDisk();
  return getMasterRuntime();
}

function norm(s: string) {
  return s.trim().toLowerCase();
}

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
  return uniqueUnits([
    ...QUANTITY_UNITS,
    ...SEEDED_COMMODITIES.map((c) => c.unit),
    ...rt.customCommodities.map((c) => c.unit),
    ...((rt.customQuantityUnits) ?? []),
  ]);
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
  const rt = masterRt();
  return [...SEEDED_COUNTERPARTIES, ...rt.customCounterparties];
}

export function getCounterpartyById(id: string): MockCounterpartyOption | undefined {
  return getMergedCounterparties().find((c) => c.id === id);
}

export function getMergedLocations(): MockLocationOption[] {
  const rt = masterRt();
  const seen = new Set<string>();
  const out: MockLocationOption[] = [];
  for (const loc of [...SEEDED_LOCATIONS, ...rt.customLocations]) {
    const k = norm(loc.name);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(loc);
  }
  return out;
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
    quantityUnits: mergedQuantityUnits(rt),
    grades: getMergedGrades(),
  };
}

export function addCustomCommodity(input: {
  name: string;
  code: string;
  unit: string;
  category?: CommodityCategory;
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
  rt.customCommoditySeq += 1;
  const row: MockCommodityOption = {
    id: `cc-${rt.customCommoditySeq}`,
    name,
    code,
    unit,
    exchange: null,
    tickerCode: null,
    category: input.category ?? CommodityCategory.OTHER,
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

export function addCustomLocation(name: string) {
  const rt = getMasterRuntime();
  const n = name.trim();
  if (!n) throw new Error("Location name is required");
  if (getMergedLocations().some((l) => norm(l.name) === norm(n))) {
    throw new Error("Location already exists");
  }
  rt.customLocationSeq += 1;
  const row = { id: `cl-${rt.customLocationSeq}`, name: n };
  rt.customLocations.push(row);
  persistMasterData();
  return row;
}

export function addCustomCounterparty(input: {
  name: string;
  code: string;
  type: CounterpartyType;
  country: string;
  kycStatus?: KycStatus;
  kycRef?: string | null;
  kycExpires?: Date | null;
  companyNameNtn?: string | null;
  ntn?: string | null;
  address?: string | null;
  bankDetails?: string | null;
}) {
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!code || !name) throw new Error("Name and code are required");
  if (getMergedCounterparties().some((c) => norm(c.code) === norm(code))) {
    throw new Error(`Counterparty code ${code} already exists`);
  }
  const rt = getMasterRuntime();
  rt.customCounterpartySeq += 1;
  const row: MockCounterpartyOption = {
    id: `ccp-${rt.customCounterpartySeq}`,
    name,
    code,
    type: input.type,
    country: input.country.trim(),
    kycStatus: input.kycStatus ?? "VERIFIED",
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
