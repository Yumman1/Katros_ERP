import { KG_PER_MAUND } from "@/lib/trade-constants";

/** Gate / weighbridge weights are always recorded in kilograms. */
export function normalizeQuantityUnit(unit: string): string {
  return unit.trim().toUpperCase();
}

/** Convert weighbridge kg into the trade's booked quantity unit. */
export function kgToQuantityUnit(kg: number, unit: string): number {
  const u = normalizeQuantityUnit(unit);
  switch (u) {
    case "KG":
      return kg;
    case "MT":
    case "TON":
    case "TONNE":
      return kg / 1000;
    case "MAUND":
      return kg / KG_PER_MAUND;
    case "LB":
      return kg / 0.45359237;
    case "CWT":
      return kg / 45.359237;
    default:
      // BAG, BUSHEL, BALE, LTR, etc. — no commodity-specific factor yet; treat 1 unit ≈ 1 kg
      return kg;
  }
}

/** Convert a quantity in the trade unit to kilograms (for gate caps and truck remaining). */
export function quantityUnitToKg(qty: number, unit: string): number {
  const u = normalizeQuantityUnit(unit);
  switch (u) {
    case "KG":
      return qty;
    case "MT":
    case "TON":
    case "TONNE":
      return qty * 1000;
    case "MAUND":
      return qty * KG_PER_MAUND;
    case "LB":
      return qty * 0.45359237;
    case "CWT":
      return qty * 45.359237;
    default:
      return qty;
  }
}

/** Minimum open qty treated as zero (in trade units). */
export function openQtyEpsilon(unit: string): number {
  const u = normalizeQuantityUnit(unit);
  if (u === "KG") return 0.5;
  if (u === "MAUND") return 0.001;
  return 0.001;
}

export function isOpenQty(qty: number, unit: string): boolean {
  return qty > openQtyEpsilon(unit);
}
