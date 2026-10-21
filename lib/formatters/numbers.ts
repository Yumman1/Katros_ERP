export function formatCurrency(value: number, currency = "USD"): string {
  const code =
    currency === "PKR"
      ? "PKR"
      : currency === "EUR"
        ? "EUR"
        : currency === "MYR"
          ? "MYR"
          : "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

/** Round for display and drop a signed zero (`-0`, `-0.0`) so it prints as `0`. */
function qtyForDisplay(value: number, maxFrac: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** Math.max(0, maxFrac);
  const rounded = Math.round(n * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

export function formatQty(value: number, maxFrac = 2): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: maxFrac,
    maximumFractionDigits: maxFrac,
  }).format(qtyForDisplay(value, maxFrac));
}

export function formatQtyWithUnit(value: number, unit = "MT", maxFrac = 2): string {
  return `${formatQty(value, maxFrac)} ${unit}`;
}

export function formatPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}
