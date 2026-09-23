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
