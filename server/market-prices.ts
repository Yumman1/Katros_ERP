import { readPersisted, writePersisted } from "@/server/local-persist";
import { getMergedCommodities } from "@/server/trader-master-data";
import { QUANTITY_UNITS } from "@/lib/trade-constants";

export const MARKET_PRICES_FILE = "market-prices.json";

export const DESK_MARKET_CURRENCIES = ["USD", "PKR", "MYR", "EUR", "CNY"] as const;
export type DeskMarketCurrency = (typeof DESK_MARKET_CURRENCIES)[number];

export type DeskPriceLeg = {
  amount: number;
  currency: string;
  unit: string;
};

export type StoredMarketPrice = {
  code: string;
  cnf: DeskPriceLeg | null;
  yesterday: DeskPriceLeg | null;
  priceDate: string;
  updatedAt: string;
  updatedBy?: string;
};

type MarketPriceStore = {
  prices: Record<string, StoredMarketPrice>;
};

export type MarketPriceSnapshot = {
  code: string;
  name: string;
  cnf: number | null;
  cnfCurrency: string | null;
  cnfUnit: string | null;
  yesterdayRate: number | null;
  yesterdayCurrency: string | null;
  yesterdayUnit: string | null;
  /** Only set when CNF and yesterday share the same currency and unit. */
  chgPct: number | null;
  asOf: string;
  priceDate: string;
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function emptyStore(): MarketPriceStore {
  return { prices: {} };
}

function isPositiveAmount(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function normalizeLeg(
  amount: unknown,
  currency: unknown,
  unit: unknown,
): DeskPriceLeg | null {
  if (!isPositiveAmount(amount)) return null;
  const c = typeof currency === "string" ? currency.trim().toUpperCase() : "";
  const u = typeof unit === "string" ? unit.trim() : "";
  if (!c || !u) return null;
  return { amount, currency: c, unit: u };
}

type LegacyRow = {
  code?: string;
  cnf?: DeskPriceLeg | number | null;
  yesterday?: DeskPriceLeg | null;
  closePrice?: number;
  previousClose?: number;
  yesterdayRate?: number;
  currency?: string;
  unit?: string;
  cnfCurrency?: string;
  cnfUnit?: string;
  yesterdayCurrency?: string;
  yesterdayUnit?: string;
  priceDate?: string;
  updatedAt?: string;
  updatedBy?: string;
};

function migrateRow(code: string, row: LegacyRow): StoredMarketPrice | null {
  if (row.cnf && typeof row.cnf === "object" && "amount" in row.cnf) {
    const cnf = row.cnf.amount > 0 ? row.cnf : null;
    const yesterday = row.yesterday && row.yesterday.amount > 0 ? row.yesterday : null;
    if (!cnf && !yesterday) return null;
    return {
      code,
      cnf,
      yesterday,
      priceDate: row.priceDate ?? todayKey(),
      updatedAt: row.updatedAt ?? new Date().toISOString(),
      updatedBy: row.updatedBy,
    };
  }

  const cnf = normalizeLeg(
    typeof row.cnf === "number" ? row.cnf : row.closePrice,
    row.cnfCurrency ?? row.currency,
    row.cnfUnit ?? row.unit,
  );
  const yesterday = normalizeLeg(
    row.yesterdayRate ?? row.previousClose,
    row.yesterdayCurrency ?? row.currency,
    row.yesterdayUnit ?? row.unit,
  );
  if (!cnf && !yesterday) return null;

  return {
    code,
    cnf,
    yesterday,
    priceDate: row.priceDate ?? todayKey(),
    updatedAt: row.updatedAt ?? new Date().toISOString(),
    updatedBy: row.updatedBy,
  };
}

function hydrateStoreFromDisk(): MarketPriceStore {
  const raw = readPersisted<{ prices: Record<string, LegacyRow> }>(MARKET_PRICES_FILE);
  if (!raw?.prices) return emptyStore();

  const prices: Record<string, StoredMarketPrice> = {};
  for (const [code, row] of Object.entries(raw.prices)) {
    const migrated = migrateRow(code, row);
    if (migrated) prices[code] = migrated;
  }
  return { prices };
}

const MARKET_STORE_KEY = "__kastrosMarketPriceStore";

/** In-memory store survives across requests in dev; disk sync when persist is enabled. */
function getStore(): MarketPriceStore {
  const g = globalThis as typeof globalThis & { [MARKET_STORE_KEY]?: MarketPriceStore };
  if (!g[MARKET_STORE_KEY]) {
    g[MARKET_STORE_KEY] = hydrateStoreFromDisk();
  }
  return g[MARKET_STORE_KEY];
}

function loadStore(): MarketPriceStore {
  return getStore();
}

function saveStore(store: MarketPriceStore) {
  const g = globalThis as typeof globalThis & { [MARKET_STORE_KEY]?: MarketPriceStore };
  g[MARKET_STORE_KEY] = store;
  writePersisted(MARKET_PRICES_FILE, store);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function comparableChgPct(cnf: DeskPriceLeg | null, yesterday: DeskPriceLeg | null): number | null {
  if (!cnf || !yesterday) return null;
  if (cnf.currency !== yesterday.currency || cnf.unit !== yesterday.unit) return null;
  if (!(yesterday.amount > 0)) return null;
  return round2(((cnf.amount - yesterday.amount) / yesterday.amount) * 100);
}

function hasPublishedData(row: StoredMarketPrice | undefined): row is StoredMarketPrice {
  return Boolean(row && (row.cnf || row.yesterday));
}

function toSnapshot(code: string, name: string, row: StoredMarketPrice): MarketPriceSnapshot {
  return {
    code,
    name,
    cnf: row.cnf?.amount ?? null,
    cnfCurrency: row.cnf?.currency ?? null,
    cnfUnit: row.cnf?.unit ?? null,
    yesterdayRate: row.yesterday?.amount ?? null,
    yesterdayCurrency: row.yesterday?.currency ?? null,
    yesterdayUnit: row.yesterday?.unit ?? null,
    chgPct: comparableChgPct(row.cnf, row.yesterday),
    asOf: row.updatedAt,
    priceDate: row.priceDate,
  };
}

/** Commodities with at least CNF or yesterday published. */
export function getMarketPriceSnapshot(): MarketPriceSnapshot[] {
  const store = loadStore();
  const commodities = getMergedCommodities();
  const rows: MarketPriceSnapshot[] = [];

  for (const c of commodities) {
    const row = store.prices[c.code];
    if (!hasPublishedData(row)) continue;
    rows.push(toSnapshot(c.code, c.name, row));
  }

  return rows.sort((a, b) => a.code.localeCompare(b.code));
}

export function listDailyMarketPrices() {
  const commodities = getMergedCommodities();
  const store = loadStore();
  return commodities.map((c) => {
    const row = store.prices[c.code];
    const defaultUnit = c.unit || "MT";
    return {
      commodityId: c.id,
      code: c.code,
      name: c.name,
      cnf: row?.cnf?.amount ?? null,
      cnfCurrency: row?.cnf?.currency ?? "USD",
      cnfUnit: row?.cnf?.unit ?? defaultUnit,
      yesterdayRate: row?.yesterday?.amount ?? null,
      yesterdayCurrency: row?.yesterday?.currency ?? "PKR",
      yesterdayUnit: row?.yesterday?.unit ?? defaultUnit,
      priceDate: row?.priceDate ?? null,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  });
}

export function upsertDailyMarketPrice(input: {
  code: string;
  cnf?: number | null;
  cnfCurrency?: string | null;
  cnfUnit?: string | null;
  yesterdayRate?: number | null;
  yesterdayCurrency?: string | null;
  yesterdayUnit?: string | null;
  priceDate?: string;
  updatedBy?: string;
}) {
  const code = input.code.trim().toUpperCase();
  if (!code) throw new Error("Commodity code required");

  const store = loadStore();
  const existing = store.prices[code];
  const now = new Date().toISOString();
  const date = input.priceDate ?? todayKey();

  const cnfProvided = input.cnf !== undefined;
  const yesterdayProvided = input.yesterdayRate !== undefined;

  if (!cnfProvided && !yesterdayProvided) {
    throw new Error("Enter CNF and/or yesterday rate to publish");
  }

  const nextCnf = cnfProvided
    ? input.cnf == null || input.cnf === 0
      ? null
      : normalizeLeg(input.cnf, input.cnfCurrency, input.cnfUnit)
    : (existing?.cnf ?? null);

  const nextYesterday = yesterdayProvided
    ? input.yesterdayRate == null || input.yesterdayRate === 0
      ? null
      : normalizeLeg(input.yesterdayRate, input.yesterdayCurrency, input.yesterdayUnit)
    : (existing?.yesterday ?? null);

  if (cnfProvided && input.cnf != null && input.cnf > 0 && !nextCnf) {
    throw new Error("CNF requires currency and unit when a value is entered");
  }
  if (yesterdayProvided && input.yesterdayRate != null && input.yesterdayRate > 0 && !nextYesterday) {
    throw new Error("Yesterday rate requires currency and unit when a value is entered");
  }
  if (!nextCnf && !nextYesterday) {
    delete store.prices[code];
    saveStore(store);
    return null;
  }

  store.prices[code] = {
    code,
    cnf: nextCnf,
    yesterday: nextYesterday,
    priceDate: date,
    updatedAt: now,
    updatedBy: input.updatedBy,
  };

  saveStore(store);
  return store.prices[code];
}

export function getDeskMarketPrice(code: string): StoredMarketPrice | null {
  const row = loadStore().prices[code.trim().toUpperCase()];
  return hasPublishedData(row) ? row : null;
}

/** Primary desk reference — CNF if set, otherwise yesterday local. */
export function getMarketPriceForCode(code: string): number | null {
  const row = getDeskMarketPrice(code);
  if (!row) return null;
  return row.cnf?.amount ?? row.yesterday?.amount ?? null;
}

export function deskMarketUnits(): readonly string[] {
  return QUANTITY_UNITS;
}

export function marketTickerPayload() {
  return getMarketPriceSnapshot().map((p) => {
    const headline =
      p.cnf != null
        ? { price: p.cnf, ccy: p.cnfCurrency!, unit: p.cnfUnit! }
        : p.yesterdayRate != null
          ? { price: p.yesterdayRate, ccy: p.yesterdayCurrency!, unit: p.yesterdayUnit! }
          : null;
    return {
      code: p.code,
      name: p.name,
      price: headline?.price ?? 0,
      ccy: headline?.ccy ?? "USD",
      unit: headline?.unit ?? "MT",
      cnf: p.cnf,
      cnfCurrency: p.cnfCurrency,
      cnfUnit: p.cnfUnit,
      yesterdayRate: p.yesterdayRate,
      yesterdayCurrency: p.yesterdayCurrency,
      yesterdayUnit: p.yesterdayUnit,
      chgPct: p.chgPct,
      asOf: p.asOf,
    };
  });
}
