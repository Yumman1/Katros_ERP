import { isSesameCommodity, sesameTradingEntity } from "./sesame";

export type SesameEntity = "PAK" | "FZCO";
export const ENTITY_NAMES = { PAK: "Kastros Pakistan", FZCO: "Dubai FZCO" } as const;
export function tradeEntity(params: unknown): SesameEntity {
  return sesameTradingEntity((params ?? {}) as Record<string, string | number | null>) === "Kastros FZCO" ? "FZCO" : "PAK";
}
export function internalEntity(params: unknown): SesameEntity | null {
  const value = (params as Record<string, unknown> | null)?.internalCounterpartyEntity;
  return value === "PAK" || value === "FZCO" ? value : null;
}
export function paperTrade(code: string, params: unknown): boolean {
  return isSesameCommodity(code) && (tradeEntity(params) === "FZCO" || internalEntity(params) !== null);
}
export function ownershipSides(direction: string, params: unknown) {
  const own = tradeEntity(params), other = internalEntity(params);
  return direction === "BUY" ? { fromEntity: other, toEntity: own } : { fromEntity: own, toEntity: other };
}
