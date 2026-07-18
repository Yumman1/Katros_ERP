/**
 * Helpers for decimal text inputs — avoids browser number-input float artifacts
 * (e.g. 280 becoming 279.99999999999994 on re-render).
 */

/** Parse a user-typed decimal string; empty → undefined. */
export function parseNumericString(raw: string): number | undefined {
  const s = raw.replace(/,/g, "").trim();
  if (s === "" || s === ".") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** Whether the string is a valid in-progress decimal (while typing). */
export function isPartialNumericString(raw: string): boolean {
  const s = raw.replace(/,/g, "").trim();
  return s === "" || /^\d*\.?\d*$/.test(s);
}

/** Format a stored number for display without float noise. */
export function cleanNumericDisplay(n: number): string {
  if (!Number.isFinite(n)) return "";
  const rounded = Math.round(n * 1_000_000) / 1_000_000;
  if (Number.isInteger(rounded)) return String(Math.trunc(rounded));
  return String(rounded)
    .replace(/(\.\d*?[1-9])0+$/, "$1")
    .replace(/\.0+$/, "");
}

export function numericStringFromValue(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return "";
  return cleanNumericDisplay(value);
}
