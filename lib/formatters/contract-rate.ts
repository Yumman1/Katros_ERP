import { priceUnitLabel, type PriceCurrency } from "@/lib/price-units";

export function formatLockedContractRate(contract: {
  unitPrice?: number | null;
  priceCurrency?: string | null;
  priceWeightUnit?: string | null;
  ratePerMaund?: number | null;
  currency?: string;
}): string {
  if (contract.unitPrice != null && contract.priceCurrency && contract.priceWeightUnit) {
    const label = priceUnitLabel({
      currency: contract.priceCurrency as PriceCurrency,
      weightUnit: contract.priceWeightUnit,
    });
    return `${contract.unitPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${label}`;
  }
  if (contract.ratePerMaund != null) {
    const sym = contract.currency === "USD" ? "$" : "₨";
    return `${contract.ratePerMaund.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${sym}/MAUND`;
  }
  return "—";
}
