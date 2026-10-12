import { isSesameCommodity } from "@/lib/sesame";
/** Commodities that publish separate Daily Prices for Summer and Winter columns. */
export const SEASON_SPLIT_COMMODITIES = new Set(["CORN"]);

export function isSeasonSplitCommodity(code: string): boolean {
  return SEASON_SPLIT_COMMODITIES.has(code.trim().toUpperCase());
}

/** Column subtitle — season is already in the row name for split commodities. */
export function dailyPriceRowSubtitle(code: string, season: string): string {
  if (isSesameCommodity(code) || isSeasonSplitCommodity(code)) return code;
  return `${code} · ${season.charAt(0) + season.slice(1).toLowerCase()}`;
}

/** Header ticker symbol — CornS / CornW for seasonal corn, otherwise the commodity code. */
export function tickerSymbol(code: string, season?: string | null): string {
  if (isSeasonSplitCommodity(code)) {
    return season === "WINTER" ? "CornW" : "CornS";
  }
  return code.trim().toUpperCase();
}

function tickerFamily(code: string): "CORN" | "SES" | string {
  const c = code.trim().toUpperCase();
  if (isSeasonSplitCommodity(c) || c === "CORN") return "CORN";
  if (isSesameCommodity(c)) return "SES";
  return c;
}

/** Sesame desk: SES then corn. Corn desk: corn then SES. Default: corn then SES. */
export function compareTickerTicks(
  a: { code: string; season?: string | null },
  b: { code: string; season?: string | null },
  preferCode?: string | null,
): number {
  const preferFamily = preferCode ? tickerFamily(preferCode) : "CORN";
  const rank = (code: string) => {
    const family = tickerFamily(code);
    if (family === preferFamily) return 0;
    if (family === "CORN" || family === "SES") return 1;
    return 2;
  };
  const byFamily = rank(a.code) - rank(b.code);
  if (byFamily !== 0) return byFamily;
  return (a.season ?? "SUMMER").localeCompare(b.season ?? "SUMMER");
}
