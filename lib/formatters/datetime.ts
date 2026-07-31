/**
 * Every timestamp on this desk is Pakistan time.
 *
 * The servers run UTC and a browser reports whatever the machine is set to, so
 * neither can be trusted to render a Karachi trading day. Formatting is pinned
 * to Asia/Karachi here instead of at each call site — a gate-in stamped 07:54
 * when the yard saw it at 12:54 is a reconciliation problem, not a cosmetic one.
 */
export const PK_TIME_ZONE = "Asia/Karachi";

type DateInput = Date | string | number | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const dateFmt = new Intl.DateTimeFormat("en-PK", {
  timeZone: PK_TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const dateTimeFmt = new Intl.DateTimeFormat("en-PK", {
  timeZone: PK_TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const timeFmt = new Intl.DateTimeFormat("en-PK", {
  timeZone: PK_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "31 Jul 2026" in Pakistan time. */
export function formatPkDate(value: DateInput, fallback = "—"): string {
  const d = toDate(value);
  return d ? dateFmt.format(d) : fallback;
}

/** "31 Jul 2026, 12:54" in Pakistan time. */
export function formatPkDateTime(value: DateInput, fallback = "—"): string {
  const d = toDate(value);
  return d ? dateTimeFmt.format(d) : fallback;
}

/** "12:54" in Pakistan time. */
export function formatPkTime(value: DateInput, fallback = "—"): string {
  const d = toDate(value);
  return d ? timeFmt.format(d) : fallback;
}

/** Today's date in Pakistan as "YYYY-MM-DD" — for date inputs and defaults. */
export function pkToday(now: Date = new Date()): string {
  return pkDateInputValue(now) ?? "";
}

/** "YYYY-MM-DD" in Pakistan time — the value an <input type="date"> expects. */
export function pkDateInputValue(value: DateInput): string | null {
  const d = toDate(value);
  if (!d) return null;
  // en-CA renders ISO-shaped dates, so this stays parseable by date inputs.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
