import type { DeskMarketPrice } from "@prisma/client";
import { prisma } from "@/server/db";
import { numOrNull } from "@/server/db/convert";
import { getMergedCommodities } from "@/server/trader-master-data";
import { QUANTITY_UNITS } from "@/lib/trade-constants";
import { deskLegsToPkrPerMaund } from "@/lib/desk-mark-price";

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

function rowToStored(row: DeskMarketPrice): StoredMarketPrice {
  const cnfAmount = numOrNull(row.cnfAmount);
  const yestAmount = numOrNull(row.yestAmount);
  return {
    code: row.commodityCode,
    cnf:
      cnfAmount != null && row.cnfCurrency && row.cnfUnit
        ? { amount: cnfAmount, currency: row.cnfCurrency, unit: row.cnfUnit }
        : null,
    yesterday:
      yestAmount != null && row.yestCurrency && row.yestUnit
        ? { amount: yestAmount, currency: row.yestCurrency, unit: row.yestUnit }
        : null,
    priceDate: row.priceDate,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy ?? undefined,
  };
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

function hasPublishedData(row: StoredMarketPrice | undefined | null): row is StoredMarketPrice {
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

async function loadStoredByCode(): Promise<Map<string, StoredMarketPrice>> {
  const rows = await prisma.deskMarketPrice.findMany();
  return new Map(rows.map((r) => [r.commodityCode, rowToStored(r)]));
}

/** Commodities with at least CNF or yesterday published. */
export async function getMarketPriceSnapshot(): Promise<MarketPriceSnapshot[]> {
  const [byCode, commodities] = await Promise.all([loadStoredByCode(), getMergedCommodities()]);
  const rows: MarketPriceSnapshot[] = [];
  for (const c of commodities) {
    const row = byCode.get(c.code);
    if (!hasPublishedData(row)) continue;
    rows.push(toSnapshot(c.code, c.name, row));
  }
  return rows.sort((a, b) => a.code.localeCompare(b.code));
}

export async function listDailyMarketPrices() {
  const [byCode, commodities] = await Promise.all([loadStoredByCode(), getMergedCommodities()]);
  return commodities.map((c) => {
    const row = byCode.get(c.code);
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

export async function upsertDailyMarketPrice(input: {
  code: string;
  cnf?: number | null;
  cnfCurrency?: string | null;
  cnfUnit?: string | null;
  yesterdayRate?: number | null;
  yesterdayCurrency?: string | null;
  yesterdayUnit?: string | null;
  priceDate?: string;
  updatedBy?: string;
}): Promise<StoredMarketPrice | null> {
  const code = input.code.trim().toUpperCase();
  if (!code) throw new Error("Commodity code required");

  const existingRow = await prisma.deskMarketPrice.findUnique({
    where: { commodityCode: code },
  });
  const existing = existingRow ? rowToStored(existingRow) : null;
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
    if (existingRow) {
      await prisma.deskMarketPrice.delete({ where: { commodityCode: code } });
    }
    return null;
  }

  const data = {
    cnfAmount: nextCnf?.amount ?? null,
    cnfCurrency: nextCnf?.currency ?? null,
    cnfUnit: nextCnf?.unit ?? null,
    yestAmount: nextYesterday?.amount ?? null,
    yestCurrency: nextYesterday?.currency ?? null,
    yestUnit: nextYesterday?.unit ?? null,
    priceDate: date,
    updatedBy: input.updatedBy ?? null,
  };
  const saved = await prisma.deskMarketPrice.upsert({
    where: { commodityCode: code },
    update: data,
    create: { commodityCode: code, ...data },
  });
  return rowToStored(saved);
}

export async function getDeskMarketPrice(code: string): Promise<StoredMarketPrice | null> {
  const row = await prisma.deskMarketPrice.findUnique({
    where: { commodityCode: code.trim().toUpperCase() },
  });
  const stored = row ? rowToStored(row) : null;
  return hasPublishedData(stored) ? stored : null;
}

/** Position marking — yesterday local first, CNF optional fallback. */
export async function getMarketPriceForCode(code: string): Promise<number | null> {
  const row = await getDeskMarketPrice(code);
  if (!row) return null;
  const leg = row.yesterday ?? row.cnf;
  return leg?.amount ?? null;
}

/** PKR per maund for net-position (yesterday first). */
export async function getPositionMarkPricePkrPerMaund(code: string): Promise<number | null> {
  const row = await getDeskMarketPrice(code);
  if (!row) return null;
  return deskLegsToPkrPerMaund(row.yesterday, row.cnf);
}

export function deskMarketUnits(): readonly string[] {
  return QUANTITY_UNITS;
}

export async function marketTickerPayload() {
  return (await getMarketPriceSnapshot()).map((p) => {
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
