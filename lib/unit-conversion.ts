import { KG_PER_MAUND } from "@/lib/trade-constants";
import { kgPerUnitOf, type UnitDefinition } from "@/lib/unit-registry";

/** Gate / weighbridge weights are always recorded in kilograms. */
export function normalizeQuantityUnit(unit: string): string {
  return unit.trim().toUpperCase();
}

/** Convert weighbridge kg into the trade's booked quantity unit. */
export function kgToQuantityUnit(
  kg: number,
  unit: string,
  registry?: Map<string, UnitDefinition>,
): number {
  const factor = kgPerUnitOf(unit, registry);
  if (factor <= 0) return kg;
  return kg / factor;
}

/** Convert a quantity in the trade unit to kilograms (for gate caps and truck remaining). */
export function quantityUnitToKg(
  qty: number,
  unit: string,
  registry?: Map<string, UnitDefinition>,
): number {
  return qty * kgPerUnitOf(unit, registry);
}

/** Minimum open qty treated as zero (in trade units). */
export function openQtyEpsilon(unit: string): number {
  const u = normalizeQuantityUnit(unit);
  if (u === "KG") return 0.5;
  if (u === "MAUND" || u === "MAUND_40" || u === "MAUND_37") return 0.001;
  return 0.001;
}

export function isOpenQty(qty: number, unit: string): boolean {
  return qty > openQtyEpsilon(unit);
}

/** @deprecated Use kgPerUnitOf from unit-registry. Kept for callers that still reference KG_PER_MAUND. */
export { KG_PER_MAUND };
