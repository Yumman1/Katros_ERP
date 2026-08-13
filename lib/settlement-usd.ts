import { baseCurrencyOf, type BaseCurrency, type PriceCurrency } from "@/lib/price-units";

export type { BaseCurrency as SettlementBase };

/** Settlement currency for MTM / notional (PKR for local, USD for international). */
export function settlementBaseOf(trade: {
  priceCurrency?: string | null;
  currency?: string | null;
}): BaseCurrency {
  const raw = (trade.priceCurrency ?? trade.currency ?? "USD").trim() as PriceCurrency;
  return baseCurrencyOf(raw);
}

export function fxMapKey(commodityCode: string, season: string): string {
  return `${commodityCode.trim().toUpperCase()}::${season.trim().toUpperCase()}`;
}

/**
 * Convert an amount in settlement currency to USD.
 * PKR amounts divide by the desk FX (PKR per 1 USD); USD amounts pass through.
 */
export function amountToUsd(
  amount: number,
  settlementBase: BaseCurrency,
  fxRatePkrPerUsd: number | null | undefined,
): number | null {
  if (!Number.isFinite(amount)) return null;
  if (settlementBase === "USD") return amount;
  if (fxRatePkrPerUsd == null || !(fxRatePkrPerUsd > 0)) return null;
  return amount / fxRatePkrPerUsd;
}

/** Resolve desk FX for a trade — exact season first, then commodity fallbacks. */
export function resolveFxRateForTrade(
  fxByCommoditySeason: ReadonlyMap<string, number>,
  commodityCode: string,
  season: string | null | undefined,
): number | null {
  const code = commodityCode.trim().toUpperCase();
  const candidates = season
    ? [season.toUpperCase(), "SUMMER", "WINTER"]
    : ["SUMMER", "WINTER"];
  const seen = new Set<string>();
  for (const s of candidates) {
    const key = fxMapKey(code, s);
    if (seen.has(key)) continue;
    seen.add(key);
    const fx = fxByCommoditySeason.get(key);
    if (fx != null && fx > 0) return fx;
  }
  return null;
}

export function roundUsd(v: number): number {
  return Math.round(v * 100) / 100;
}
