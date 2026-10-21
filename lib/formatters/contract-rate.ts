import { formatCurrency } from "@/lib/formatters/numbers";
import { priceUnitLabel, priceWeightUnitLabel, type PriceCurrency } from "@/lib/price-units";

export function formatLockedContractRate(contract: {
  unitPrice?: number | null;
  priceCurrency?: string | null;
  priceWeightUnit?: string | null;
  ratePerMaund?: number | null;
  currency?: string;
}): string {
  if (contract.unitPrice != null && contract.priceCurrency && contract.priceWeightUnit) {
    const unit = priceWeightUnitLabel(contract.priceWeightUnit);
    if (contract.priceCurrency === "PKR") {
      return `${formatCurrency(contract.unitPrice, "PKR")} / ${unit}`;
    }
    const label = priceUnitLabel({
      currency: contract.priceCurrency as PriceCurrency,
      weightUnit: contract.priceWeightUnit,
    });
    return `${contract.unitPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${label}`;
  }
  if (contract.ratePerMaund != null) {
    const currency = contract.currency === "USD" ? "USD" : "PKR";
    return `${formatCurrency(contract.ratePerMaund, currency)} / maund`;
  }
  return "—";
}
