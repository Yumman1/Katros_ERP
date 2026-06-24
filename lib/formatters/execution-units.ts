import { formatQtyWithUnit } from "@/lib/formatters/numbers";

/** Summarise quantities that may use different booked units (e.g. open volume KPI). */
export function summarizeQtyByUnit(
  items: { qty: number; unit: string }[],
  maxFrac = 0,
): string {
  const map = new Map<string, number>();
  for (const { qty, unit } of items) {
    if (!unit) continue;
    map.set(unit, (map.get(unit) ?? 0) + qty);
  }
  if (map.size === 0) return "0";
  const parts = [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([unit, total]) => formatQtyWithUnit(total, unit, maxFrac));
  return parts.join(" · ");
}
