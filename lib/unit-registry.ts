/**
 * Central unit registry — every quantity path goes: unit → kg → MT.
 *
 * Built-in units ship with default kg factors; custom units are registered
 * when adding commodities or via master data and persist to disk.
 */

import { DEFAULT_KG_PER_UNIT } from "@/lib/price-units";

export type UnitDefinition = {
  code: string;
  /** Kilograms in one unit of this measure. */
  kgPerUnit: number;
  label?: string;
};

export const CANONICAL_QTY_UNIT = "MT";
export const KG_PER_MT = 1000;

function normUnit(unit: string): string {
  return unit.trim().toUpperCase();
}

/** Human-readable labels for built-in units (shown in dropdowns). */
export const BUILTIN_UNIT_LABELS: Record<string, string> = {
  MAUND_40: "MAUND (40 kg)",
  MAUND_37: "MAUND (37.324 kg)",
  MAUND: "MAUND (40 kg)",
};

/** Built-in units always available. */
export const BUILTIN_UNITS: UnitDefinition[] = Object.entries(DEFAULT_KG_PER_UNIT).map(
  ([code, kgPerUnit]) => ({
    code,
    kgPerUnit,
    label: BUILTIN_UNIT_LABELS[code],
  }),
);

/** Merge built-in + custom unit definitions (custom overrides built-in on same code). */
export function mergeUnitRegistry(customUnits: UnitDefinition[] = []): Map<string, UnitDefinition> {
  const map = new Map<string, UnitDefinition>();
  for (const u of BUILTIN_UNITS) {
    map.set(normUnit(u.code), { ...u, code: u.code.toUpperCase() });
  }
  for (const u of customUnits) {
    const code = normUnit(u.code);
    if (!code || u.kgPerUnit <= 0) continue;
    map.set(code, { code, kgPerUnit: u.kgPerUnit, label: u.label });
  }
  return map;
}

/** Dropdown / display label for a unit code. */
export function unitOptionLabel(code: string, registry?: Map<string, UnitDefinition>): string {
  const key = normUnit(code);
  const def = registry?.get(key);
  if (def?.label) return def.label;
  if (def) return `${def.code} (${def.kgPerUnit} kg)`;
  const kg = DEFAULT_KG_PER_UNIT[key];
  if (kg != null) {
    const builtin = BUILTIN_UNIT_LABELS[key];
    if (builtin) return builtin;
    return `${key} (${kg} kg)`;
  }
  return code;
}

/** Kilograms in one unit — falls back to 1000 (treat as MT-like) if unknown. */
export function kgPerUnitOf(unit: string, registry?: Map<string, UnitDefinition>): number {
  const key = normUnit(unit);
  const fromRegistry = registry?.get(key)?.kgPerUnit;
  if (fromRegistry != null && fromRegistry > 0) return fromRegistry;
  return DEFAULT_KG_PER_UNIT[key] ?? DEFAULT_KG_PER_UNIT[unit] ?? KG_PER_MT;
}

/** Convert any quantity to kilograms. */
export function toKg(qty: number, unit: string, registry?: Map<string, UnitDefinition>): number {
  return qty * kgPerUnitOf(unit, registry);
}

/** Convert kilograms to metric tonnes. */
export function kgToMt(kg: number): number {
  return kg / KG_PER_MT;
}

/** Convert any quantity directly to MT (canonical storage unit). */
export function toMt(qty: number, unit: string, registry?: Map<string, UnitDefinition>): number {
  return kgToMt(toKg(qty, unit, registry));
}

/** Convert MT back to a display unit. */
export function mtToUnit(mt: number, unit: string, registry?: Map<string, UnitDefinition>): number {
  const kg = mt * KG_PER_MT;
  const factor = kgPerUnitOf(unit, registry);
  return factor > 0 ? kg / factor : mt;
}

/** Human-readable conversion chain for UI previews. */
export function formatConversionPreview(
  qty: number,
  unit: string,
  registry?: Map<string, UnitDefinition>,
): { kg: number; mt: number; label: string } {
  const kg = toKg(qty, unit, registry);
  const mt = kgToMt(kg);
  const u = normUnit(unit);
  const unitLabel = unitOptionLabel(unit, registry);
  if (u === "MT" || u === "TON" || u === "TONNE") {
    return {
      kg,
      mt,
      label: `${qty.toLocaleString()} ${unitLabel} = ${kg.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg`,
    };
  }
  return {
    kg,
    mt,
    label: `${qty.toLocaleString()} ${unitLabel} → ${kg.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg → ${mt.toLocaleString(undefined, { maximumFractionDigits: 4 })} MT`,
  };
}
