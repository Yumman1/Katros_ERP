import type { Prisma } from "@prisma/client";
import { num } from "@/server/db/convert";
import { KG_PER_MAUND_40 } from "@/lib/trade-constants";

export const MAUNDS_PER_MT = 1000 / KG_PER_MAUND_40;

export type ContractRateFields = {
  tradeRef: string;
  ratePerKg: Prisma.Decimal | number | null;
  ratePerMaund: Prisma.Decimal | number | null;
};

/** Contract rate in PKR/MT — prefer ratePerKg × 1000, fall back to ratePerMaund × maunds per MT. */
export function contractRatePkrPerMt(contract: Pick<ContractRateFields, "ratePerKg" | "ratePerMaund">): number | null {
  const perKg = contract.ratePerKg != null ? num(contract.ratePerKg) : null;
  const perMaund = contract.ratePerMaund != null ? num(contract.ratePerMaund) : null;
  if (perKg != null && perKg > 0) return perKg * 1000;
  if (perMaund != null && perMaund > 0) return perMaund * MAUNDS_PER_MT;
  return null;
}

export function buildRatePkrPerMtByRef(contracts: ContractRateFields[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of contracts) {
    const rate = contractRatePkrPerMt(c);
    if (rate != null) map.set(c.tradeRef, rate);
  }
  return map;
}

export function pkrPerMtToPkrPerMaund(pkrPerMt: number): number {
  return pkrPerMt / MAUNDS_PER_MT;
}

export type WeightedPurchasePriceResult = {
  /** Σ rated receipt qty (MT). */
  ratedQtyMt: number;
  /** Σ all receipt qty in scope (MT), including unrated trades. */
  totalQtyMt: number;
  weightedPurchasePricePkrPerMt: number | null;
  weightedPurchasePricePkrPerMaund: number | null;
};

/**
 * Stock-weighted average purchase price from inbound receipts:
 * Σ(receipt qty × trade contract rate) / Σ(receipt qty with a rate), PKR/MT.
 *
 * Same metric as Execution → Inventory → "Total weighted purchase price".
 * Optional `tradeFilter` scopes to commodity/season (or any trade subset).
 */
export function computeWeightedPurchasePrice(input: {
  inboundQtyByTradeRef: Map<string, number> | Array<{ tradeRef: string; qtyMt: number }>;
  ratePkrPerMtByRef: Map<string, number>;
  tradeFilter?: (tradeRef: string) => boolean;
}): WeightedPurchasePriceResult {
  const rows =
    input.inboundQtyByTradeRef instanceof Map
      ? [...input.inboundQtyByTradeRef.entries()].map(([tradeRef, qtyMt]) => ({ tradeRef, qtyMt }))
      : input.inboundQtyByTradeRef;

  let totalQtyMt = 0;
  let ratedQtyMt = 0;
  let ratedValuePkr = 0;

  for (const { tradeRef, qtyMt } of rows) {
    const qty = num(qtyMt);
    if (qty <= 0) continue;
    if (input.tradeFilter && !input.tradeFilter(tradeRef)) continue;

    totalQtyMt += qty;
    const rate = input.ratePkrPerMtByRef.get(tradeRef);
    if (rate != null) {
      ratedQtyMt += qty;
      ratedValuePkr += qty * rate;
    }
  }

  const weightedPurchasePricePkrPerMt = ratedQtyMt > 0 ? ratedValuePkr / ratedQtyMt : null;

  return {
    ratedQtyMt,
    totalQtyMt,
    weightedPurchasePricePkrPerMt,
    weightedPurchasePricePkrPerMaund:
      weightedPurchasePricePkrPerMt != null ? pkrPerMtToPkrPerMaund(weightedPurchasePricePkrPerMt) : null,
  };
}
