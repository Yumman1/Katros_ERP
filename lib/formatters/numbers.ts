export function formatCurrency(value: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency === "PKR" ? "PKR" : currency === "EUR" ? "EUR" : "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function formatQty(value: number, maxFrac = 2): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: maxFrac,
    maximumFractionDigits: maxFrac,
  }).format(value);
}

export function formatQtyWithUnit(value: number, unit = "MT", maxFrac = 2): string {
  return `${formatQty(value, maxFrac)} ${unit}`;
}

export function formatPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}
