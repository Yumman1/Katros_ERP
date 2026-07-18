import { KG_PER_MAUND_37, KG_PER_MAUND_40 } from "@/lib/trade-constants";

/**
 * Price-unit model.
 *
 * A commodity is quoted differently per market (a "price metric") but is stored
 * and used throughout the app in a single canonical quantity unit (default MT).
 * This module maps any quoted price into base-currency-per-canonical-quantity-unit
 * so every downstream module (notional, exposure, MTM, execution payments) is
 * consistent regardless of how the trade was quoted.
 *
 * Example (Cotton):
 *   International — cents per pound (¢/lb),  1 lb = 0.45359237 kg
 *   Local        — PKR per maund (₨/maund), 40 kg or 37.324 kg variants
 *   Canonical qty unit — MT (1 MT = 1000 kg)
 */

export const PRICE_CURRENCIES = ["PKR", "USD", "USd"] as const;
export type PriceCurrency = (typeof PRICE_CURRENCIES)[number];

export type BaseCurrency = "PKR" | "USD";

export const PRICE_CURRENCY_LABELS: Record<PriceCurrency, string> = {
  PKR: "PKR (₨)",
  USD: "USD ($)",
  USd: "US cents (¢)",
};

export const PRICE_CURRENCY_SYMBOL: Record<PriceCurrency, string> = {
  PKR: "₨",
  USD: "$",
  USd: "¢",
};

/** Short label for commission / flat amounts in the quoted currency only. */
export function quotedCurrencyLabel(currency: PriceCurrency): string {
  return PRICE_CURRENCY_LABELS[currency];
}

/** The settlement (base) currency a quoted price currency resolves to. */
export function baseCurrencyOf(c: PriceCurrency): BaseCurrency {
  return c === "PKR" ? "PKR" : "USD";
}

/** Value in the base currency for 1 unit of the quoted currency (US cents → 0.01 USD). */
export function currencyToBaseFactor(c: PriceCurrency): number {
  return c === "USd" ? 0.01 : 1;
}

/** Weight units usable as a price denominator. */
export const PRICE_WEIGHT_UNITS = [
  "MT",
  "KG",
  "MAUND_40",
  "MAUND_37",
  "LB",
  "CWT",
  "BUSHEL",
  "BALE",
  "BAG",
  "LTR",
] as const;

/** Default kilograms per unit. Two maund variants; MAUND alias = 40 kg. */
export const DEFAULT_KG_PER_UNIT: Record<string, number> = {
  MT: 1000,
  TON: 1000,
  TONNE: 1000,
  KG: 1,
  MAUND_40: KG_PER_MAUND_40,
  MAUND_37: KG_PER_MAUND_37,
  MAUND: KG_PER_MAUND_40,
  LB: 0.45359237,
  CWT: 45.359237,
  BUSHEL: 1,
  BALE: 1,
  BAG: 1,
  LTR: 1,
};

export function defaultKgPerUnit(unit: string): number {
  return DEFAULT_KG_PER_UNIT[unit.trim().toUpperCase()] ?? 1000;
}

/** How a price is quoted: currency + weight denominator + that denominator's kg factor. */
export type PriceBasis = {
  currency: PriceCurrency;
  weightUnit: string;
  kgPerUnit: number;
};

/** Per-scope price bases configured on a commodity. */
export type CommodityPriceUnits = {
  LOCAL: PriceBasis;
  INTERNATIONAL: PriceBasis;
};

type CommodityPriceShape = {
  unit: string;
  canonicalKgPerUnit?: number | null;
  priceUnits?: CommodityPriceUnits | null;
};

/** Kilograms per one canonical quantity unit for a commodity (e.g. MT → 1000). */
export function canonicalKgPerUnitOf(commodity: CommodityPriceShape | undefined): number {
  if (commodity?.canonicalKgPerUnit != null) return commodity.canonicalKgPerUnit;
  return defaultKgPerUnit(commodity?.unit ?? "MT");
}

/** Resolve the price basis for a commodity + market scope, falling back to sensible defaults. */
export function resolvePriceBasis(
  commodity: CommodityPriceShape | undefined,
  scope: "LOCAL" | "INTERNATIONAL",
): PriceBasis {
  const configured = commodity?.priceUnits?.[scope];
  if (configured) return configured;
  return {
    currency: scope === "LOCAL" ? "PKR" : "USD",
    weightUnit: commodity?.unit ?? "MT",
    kgPerUnit: canonicalKgPerUnitOf(commodity),
  };
}

/**
 * Convert a price quoted in `basis` into base-currency per canonical quantity unit.
 *
 * pricePerCanonical = price × currencyFactor × (canonicalKgPerUnit / basisKgPerUnit)
 */
export function toPricePerCanonicalQty(
  price: number,
  basis: PriceBasis,
  canonicalKgPerUnit: number,
): number {
  if (!basis.kgPerUnit) return price;
  return price * currencyToBaseFactor(basis.currency) * (canonicalKgPerUnit / basis.kgPerUnit);
}

/** Short label for a price basis, e.g. "¢/lb", "₨/maund", "$/MT". */
export function priceUnitLabel(basis: { currency: PriceCurrency; weightUnit: string }): string {
  return `${PRICE_CURRENCY_SYMBOL[basis.currency]}/${basis.weightUnit}`;
}
