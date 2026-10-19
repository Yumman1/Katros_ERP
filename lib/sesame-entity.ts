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
/**
 * Paper (ownership-only) trades are FZCO's own external purchases. An internal
 * Pakistan → FZCO sale is a normal physical Pakistan sale: stock leaves a
 * Pakistan warehouse through the triparty gate-out and is shipped to FZCO's buyer.
 */
export function paperTrade(code: string, params: unknown): boolean {
  return isSesameCommodity(code) && tradeEntity(params) === "FZCO" && internalEntity(params) === null;
}
/** Pakistan sells, Dubai FZCO buys — the only supported internal trade shape. */
export function internalPakSale(code: string, direction: string, params: unknown): boolean {
  return isSesameCommodity(code) && direction === "SELL" && tradeEntity(params) === "PAK" && internalEntity(params) === "FZCO";
}
/**
 * Sesame international sales settle by payment, not by shipped quantity: the
 * PAK → FZCO internal sale and every FZCO sale stay open until vouchers cover
 * the invoiced (BL) amount. Everything else closes on quantity.
 */
export function closesOnPayment(code: string, direction: string, tradeScope: string | null | undefined, params: unknown): boolean {
  if (!isSesameCommodity(code) || direction !== "SELL") return false;
  if (internalPakSale(code, direction, params)) return true;
  return tradeEntity(params) === "FZCO" && internalEntity(params) === null && tradeScope === "INTERNATIONAL";
}
/** Receipts must cover every BL invoice and shipped qty must be within tolerance. */
export function shouldCloseOnFullPayment(input: {
  invoicedPkr: number;
  receivedPkr: number;
  contractualQtyMt: number;
  fulfilledQtyMt: number;
  toleranceMt: number;
}): boolean {
  if (input.invoicedPkr <= 0 || input.receivedPkr + 0.005 < input.invoicedPkr) return false;
  return input.fulfilledQtyMt + 0.000001 >= input.contractualQtyMt - input.toleranceMt;
}
export function ownershipSides(direction: string, params: unknown) {
  const own = tradeEntity(params), other = internalEntity(params);
  return direction === "BUY" ? { fromEntity: other, toEntity: own } : { fromEntity: own, toEntity: other };
}
