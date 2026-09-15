/** Read-only list filtering. Never sorts or changes the source records. */
export type FilterField = { key: string; label: string; paths: string[] };
export type FilterDate = { label: string; paths: string[] };
export type FilterConfig = {
  search?: boolean;
  fields?: FilterField[];
  date?: FilterDate;
  deliveryDate?: FilterDate;
  searchPaths?: string[];
  quantityPaths?: string[];
};
export type FilterState = {
  search: string;
  selected: Record<string, string>;
  dateMode: "all" | "day" | "range";
  from: string;
  to: string;
  deliveryFrom: string;
  deliveryTo: string;
  sort: string;
};
export const emptyFilters = (): FilterState => ({ search: "", selected: {}, dateMode: "all", from: "", to: "", deliveryFrom: "", deliveryTo: "", sort: "original" });

export function restoreFilters(value: unknown): FilterState {
  const state = emptyFilters();
  if (!value || typeof value !== "object") return state;
  const data = value as Record<string, unknown>;
  for (const key of ["search", "from", "to", "deliveryFrom", "deliveryTo"] as const) {
    if (typeof data[key] === "string") state[key] = data[key];
  }
  if (["all", "day", "range"].includes(String(data.dateMode))) state.dateMode = data.dateMode as FilterState["dateMode"];
  if (["original", "date-asc", "date-desc", "delivery-asc", "delivery-desc", "quantity-asc", "quantity-desc"].includes(String(data.sort))) state.sort = String(data.sort);
  if (data.selected && typeof data.selected === "object" && !Array.isArray(data.selected)) {
    state.selected = Object.fromEntries(Object.entries(data.selected).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  }
  return state;
}

export function field(key: string, label: string, ...paths: string[]): FilterField {
  return { key, label, paths: paths.length ? paths : [key] };
}

export function valueAt(row: unknown, paths: string[]): unknown {
  function walk(value: unknown, parts: string[]): unknown {
    if (!parts.length) return value;
    if (Array.isArray(value)) return value.flatMap((item) => walk(item, parts) ?? []);
    return value != null && typeof value === "object" ? walk((value as Record<string, unknown>)[parts[0]], parts.slice(1)) : undefined;
  }
  for (const path of paths) {
    const value = walk(row, path.split("."));
    if (value != null && value !== "" && (!Array.isArray(value) || value.length)) return value;
  }
  return undefined;
}

const pakistanDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" });
export function calendarDay(value: unknown): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : "";
  }
  if (!(value instanceof Date) && typeof value !== "string") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = pakistanDay.formatToParts(date);
  return ["year", "month", "day"].map((part) => parts.find((p) => p.type === part)?.value).join("-");
}

function inRange(value: unknown, from: string, to: string): boolean {
  if (!from && !to) return true;
  const day = calendarDay(value);
  return !!day && (!from || day >= from) && (!to || day <= to);
}

export const tradeFields = [
  field("side", "Side", "direction", "side", "summary.direction"),
  field("commodity", "Commodity", "commodityCode", "commodity.code", "summary.commodityLabel"),
  field("market", "Market", "tradeScope", "payload.form.tradeScope"),
  field("counterparty", "Counterparty", "counterpartyName", "counterparty.name", "summary.counterpartyLabel"),
];
export const tradeDate: FilterDate = { label: "Trade date", paths: ["tradeDate", "contractDate", "payload.form.tradeDate"] };
export const deliveryDate: FilterDate = { label: "Delivery date", paths: ["deliveryStart", "deliveryDate", "payload.form.deliveryStart"] };
export const defaultSearchPaths = ["tradeRef", "ref", "refLabel", "entityRef", "entityLabel", "counterpartyName", "counterparty.name", "commodityCode", "commodity.name", "name", "code", "email", "truckNo", "gatepassNo", "voucherNo", "noteRef", "traderName", "requestedByName", "summary.commodityLabel", "summary.counterpartyLabel", "warehouseName", "incoterms", "transferRef", "deliveryOrderNo"];
export const tradeFilterConfig: FilterConfig = { fields: tradeFields, date: tradeDate, deliveryDate, quantityPaths: ["quantity", "contractualQtyMt"] };
export const requestFilterConfig: FilterConfig = {
  fields: [field("type", "Request type", "entityType", "kind"), field("action", "Action"), field("status", "Status"), field("requester", "Requested by", "requestedByName", "traderName")],
  date: { label: "Request date", paths: ["requestedAt", "createdAt"] },
};
export const rejectionFilterConfig: FilterConfig = {
  fields: [field("kind", "Rejection type"), field("counterparty", "Counterparty", "counterpartyName"), field("rejectedBy", "Rejected by")],
  date: { label: "Rejection date", paths: ["createdAt"] },
};

export function matchesRecord(row: unknown, state: FilterState, config: FilterConfig): boolean {
  const q = state.search.trim().toLocaleLowerCase();
  if (config.search !== false && q && !(config.searchPaths ?? defaultSearchPaths).some((p) => String(valueAt(row, [p]) ?? "").toLocaleLowerCase().includes(q))) return false;
  for (const f of config.fields ?? []) {
    const selected = state.selected[f.key];
    const value = valueAt(row, f.paths);
    if (selected && !(Array.isArray(value) ? value.map(String).includes(selected) : String(value ?? "") === selected)) return false;
  }
  if (config.date && state.dateMode !== "all" && !inRange(valueAt(row, config.date.paths), state.from, state.dateMode === "day" ? state.from : state.to)) return false;
  if (config.deliveryDate && !inRange(valueAt(row, config.deliveryDate.paths), state.deliveryFrom, state.deliveryTo)) return false;
  return true;
}

export function filterRecords<T>(rows: readonly T[], state: FilterState, config: FilterConfig): T[] {
  const result = rows.filter((row) => matchesRecord(row, state, config));
  const date = state.sort.startsWith("delivery") ? config.deliveryDate : config.date;
  const quantity = state.sort.startsWith("quantity");
  if (state.sort !== "original" && (quantity ? config.quantityPaths : date)) {
    result.sort((a, b) => {
      const av = quantity ? valueAt(a, config.quantityPaths!) : calendarDay(valueAt(a, date!.paths));
      const bv = quantity ? valueAt(b, config.quantityPaths!) : calendarDay(valueAt(b, date!.paths));
      if (av == null || av === "") return bv == null || bv === "" ? 0 : 1;
      if (bv == null || bv === "") return -1;
      const order = quantity ? Number(av) - Number(bv) : String(av).localeCompare(String(bv));
      return state.sort.endsWith("desc") ? -order : order;
    });
  }
  return result;
}
