export type ExcelRow = Record<string, string | number | boolean | null | undefined>;

// xlsx is ~1MB of JS; load it on demand so it never sits in a page's initial bundle.
async function loadXlsx() {
  return import("xlsx");
}

/** Download rows as an .xlsx file (client-side). */
export async function downloadExcel(rows: ExcelRow[], sheetName: string, filename: string) {
  if (rows.length === 0) return;
  const XLSX = await loadXlsx();
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  const out = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  XLSX.writeFile(wb, out);
}

/** Parse CSV text and save as .xlsx */
export async function downloadCsvAsExcel(csv: string, sheetName: string, filename: string) {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(csv, { type: "string" });
  const out = filename.endsWith(".xlsx") ? filename : filename.replace(/\.csv$/i, ".xlsx");
  if (!out.endsWith(".xlsx")) {
    XLSX.writeFile(wb, `${out}.xlsx`);
  } else {
    XLSX.writeFile(wb, out);
  }
}

export function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export function parseDateInput(value: string): Date | null {
  if (!value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function inDateRange(
  date: Date | string,
  from: Date | null,
  to: Date | null,
): boolean {
  const d = new Date(date);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}
