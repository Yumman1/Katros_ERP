import { KG_PER_MAUND_40 } from "@/lib/trade-constants";
import {
  canonicalKgPerUnitOf,
  currencyToBaseFactor,
  defaultKgPerUnit,
  toPricePerCanonicalQty,
  type PriceBasis,
  type PriceCurrency,
} from "@/lib/price-units";
import type { DeskPriceLeg, StoredMarketPrice } from "@/server/market-prices";

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Position marking uses yesterday local first; CNF is optional fallback. */
export function positionMarkLeg(stored: StoredMarketPrice | null | undefined): DeskPriceLeg | null {
  if (!stored) return null;
  return stored.yesterday ?? stored.cnf ?? null;
}

/** Display leg for market watch tiles — yesterday when set, else CNF. */
export function displayMarkLeg(stored: StoredMarketPrice | null | undefined): DeskPriceLeg | null {
  return positionMarkLeg(stored);
}

function deskCurrency(c: string): PriceCurrency {
  const u = c.trim().toUpperCase();
  if (u === "PKR") return "PKR";
  if (u === "USD") return "USD";
  return "USD";
}

/** Normalise a desk leg to PKR per 40-kg maund (net-position sheet convention). */
export function deskLegToPkrPerMaund(leg: DeskPriceLeg): number | null {
  const amount = leg.amount;
  if (!(amount > 0)) return null;
  const ccy = leg.currency.trim().toUpperCase();
  if (ccy !== "PKR") return null;
  const kgPerQuoted = defaultKgPerUnit(leg.unit || "MAUND_40");
  if (!(kgPerQuoted > 0)) return null;
  return round2((amount / kgPerQuoted) * KG_PER_MAUND_40);
}

/** Convert desk leg into base-currency per canonical quantity unit (MTM book basis). */
export function deskLegToPricePerCanonicalQty(
  leg: DeskPriceLeg,
  canonicalKgPerUnit: number,
): number {
  const basis: PriceBasis = {
    currency: deskCurrency(leg.currency),
    weightUnit: leg.unit,
    kgPerUnit: defaultKgPerUnit(leg.unit),
  };
  return toPricePerCanonicalQty(leg.amount, basis, canonicalKgPerUnit);
}

type TradeMarkInputs = {
  quantityUnit: string;
  pricePerCanonicalQty?: number | null;
  price?: number;
  commodity?: { unit?: string | null; canonicalKgPerUnit?: number | null } | null;
};

/** Resolve mark price on the same basis as the trade book price for MTM. */
export function markPriceForTradeMtm(
  stored: StoredMarketPrice | null | undefined,
  trade: TradeMarkInputs,
  storedMarketPrice?: number,
): number | null {
  const leg = positionMarkLeg(stored);
  if (leg) {
    const canonicalKg = canonicalKgPerUnitOf({
      unit: trade.quantityUnit,
      canonicalKgPerUnit: trade.commodity?.canonicalKgPerUnit,
    });
    return deskLegToPricePerCanonicalQty(leg, canonicalKg);
  }
  if (storedMarketPrice != null && storedMarketPrice > 0) return storedMarketPrice;
  return trade.pricePerCanonicalQty ?? trade.price ?? null;
}

/** Build PKR/maund from desk row fields — yesterday first, then CNF. */
export function deskLegsToPkrPerMaund(
  yesterday: DeskPriceLeg | null,
  cnf: DeskPriceLeg | null,
): number | null {
  if (yesterday) {
    const pkr = deskLegToPkrPerMaund(yesterday);
    if (pkr != null) return pkr;
  }
  if (cnf) return deskLegToPkrPerMaund(cnf);
  return null;
}

/** USD desk legs converted via FX when PKR normalisation is not possible. */
export function deskLegToPkrPerMaundWithFx(leg: DeskPriceLeg, fxRate: number | null): number | null {
  const direct = deskLegToPkrPerMaund(leg);
  if (direct != null) return direct;
  if (leg.currency.trim().toUpperCase() !== "USD" || fxRate == null || !(fxRate > 0)) return null;
  const kgPerQuoted = defaultKgPerUnit(leg.unit || "MT");
  if (!(kgPerQuoted > 0)) return null;
  const pkrPerKg = (leg.amount * currencyToBaseFactor("USD") * fxRate) / kgPerQuoted;
  return round2(pkrPerKg * KG_PER_MAUND_40);
}
