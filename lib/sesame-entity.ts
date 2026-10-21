import { isSesameCommodity, sesameTradingEntity } from "./sesame";

export type SesameEntity = "PAK" | "FZCO";
export const ENTITY_NAMES = { PAK: "Kastros Pakistan", FZCO: "Dubai FZCO" } as const;
/** FZCO is a books entity. It does not own bags sitting in a Pakistan warehouse. */
export const FZCO_NO_PAKISTAN_WAREHOUSE =
  "FZCO does not hold inventory in Pakistan warehouses. Ship Pakistan stock on a Pakistan sale (triparty) or record a third-party truck movement.";
/** FZCO has no paper/off-site ownership desk. Purchases and sales stay open until paid. */
export const FZCO_NO_PAPER_OWNERSHIP =
  "FZCO does not confirm paper ownership. Open purchases close when FZCO pays Pakistan or the supplier. Open sales close when the buyer pays FZCO.";
export function tradeEntity(params: unknown): SesameEntity {
  return sesameTradingEntity((params ?? {}) as Record<string, string | number | null>) === "Kastros FZCO" ? "FZCO" : "PAK";
}
export function internalEntity(params: unknown): SesameEntity | null {
  const value = (params as Record<string, unknown> | null)?.internalCounterpartyEntity;
  return value === "PAK" || value === "FZCO" ? value : null;
}
/**
 * FZCO booking a purchase from Kastros Pakistan (internal PAK or INTERCO-PAK).
 * There is one physical record: Pakistan's warehouse sale to Dubai FZCO.
 */
export function isFzcoBuyFromPakistan(
  code: string,
  direction: string,
  params: unknown,
  counterpartyCode?: string | null,
): boolean {
  if (!isSesameCommodity(code) || direction !== "BUY" || tradeEntity(params) !== "FZCO") return false;
  return internalEntity(params) === "PAK" || counterpartyCode === "INTERCO-PAK";
}
/** Rewrite an FZCO-from-Pakistan purchase into the canonical Pakistan warehouse sale. */
export function canonicalizeInternalPakSale(
  code: string,
  direction: string,
  params: Record<string, unknown> | null | undefined,
  counterpartyCode?: string | null,
): { direction: "BUY" | "SELL"; params: Record<string, unknown>; internalPakSale: boolean } {
  const next: Record<string, unknown> = { ...(params ?? {}) };
  if (internalPakSale(code, direction, next) || isFzcoBuyFromPakistan(code, direction, next, counterpartyCode)) {
    next.tradingEntity = "Kastros PAK";
    next.internalCounterpartyEntity = "FZCO";
    return { direction: "SELL", params: next, internalPakSale: true };
  }
  return { direction: direction === "BUY" ? "BUY" : "SELL", params: next, internalPakSale: false };
}
/**
 * FZCO trades skip Pakistan warehouse allocation. They are open-purchase /
 * open-sale books that close on payment, not paper inventory confirmation.
 * An internal Pakistan → FZCO sale is a physical Pakistan warehouse sale.
 */
export function paperTrade(
  code: string,
  params: unknown,
  extra?: { direction?: string; counterpartyCode?: string | null },
): boolean {
  if (isFzcoBuyFromPakistan(code, extra?.direction ?? "", params, extra?.counterpartyCode)) return false;
  return isSesameCommodity(code) && tradeEntity(params) === "FZCO" && internalEntity(params) === null;
}
/** Pakistan sells, Dubai FZCO buys — the only supported internal trade shape. */
export function internalPakSale(code: string, direction: string, params: unknown): boolean {
  return isSesameCommodity(code) && direction === "SELL" && tradeEntity(params) === "PAK" && internalEntity(params) === "FZCO";
}
/** One physical Pakistan sale appears on both sesame desks: SELL in Pakistan, BUY in FZCO. */
export function belongsToSesameDesk(code: string, params: unknown, asEntity: SesameEntity): boolean {
  if (!isSesameCommodity(code)) return true;
  return tradeEntity(params) === asEntity || internalEntity(params) === asEntity;
}
export function deskSide(
  code: string,
  direction: string,
  params: unknown,
  asEntity: SesameEntity,
): "BUY" | "SELL" {
  const stored: "BUY" | "SELL" = direction === "BUY" ? "BUY" : "SELL";
  if (!isSesameCommodity(code) || tradeEntity(params) === asEntity) return stored;
  if (internalEntity(params) === asEntity) return stored === "BUY" ? "SELL" : "BUY";
  return stored;
}
export function deskCounterpartyLabel(
  code: string,
  params: unknown,
  storedName: string,
  asEntity: SesameEntity,
): string {
  if (!isSesameCommodity(code) || !internalEntity(params)) return storedName;
  const other = tradeEntity(params) === asEntity ? internalEntity(params) : tradeEntity(params);
  return other ? ENTITY_NAMES[other] : storedName;
}
export function presentTraderBook<T extends {
  direction: string;
  commodity: { code: string };
  tradeParams?: unknown;
  counterparty: { name: string };
}>(trades: T[], entity?: SesameEntity): T[] {
  if (!entity) return trades;
  return trades
    .filter((t) => belongsToSesameDesk(t.commodity.code, t.tradeParams, entity))
    .map((t) => ({
      ...t,
      direction: deskSide(t.commodity.code, t.direction, t.tradeParams, entity) as T["direction"],
      counterparty: {
        ...t.counterparty,
        name: deskCounterpartyLabel(t.commodity.code, t.tradeParams, t.counterparty.name, entity),
      },
    }));
}
/**
 * FZCO purchases and sales stay on the book until paid. Pakistan → FZCO
 * internals close when FZCO pays Kastros Pakistan.
 */
export function closesOnPayment(code: string, direction: string, tradeScope: string | null | undefined, params: unknown): boolean {
  if (!isSesameCommodity(code)) return false;
  if (internalPakSale(code, direction, params)) return true;
  return tradeEntity(params) === "FZCO" && internalEntity(params) === null;
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
/**
 * Internal PAK → FZCO sales stay on the open book until payment closes them.
 * Pakistan keeps the full unpaid sale even after the stock has left. FZCO only
 * books the matching purchase once Pakistan has shipped. External FZCO
 * purchases and sales stay at full quantity until the payment close.
 */
export function sesameBookQty(input: {
  quantityMt: number;
  openMt: number;
  receivedMt: number;
  internal: boolean;
  closeOnPayment: boolean;
  contractStatus?: string | null;
  asEntity: SesameEntity;
}): number {
  if(input.closeOnPayment && input.contractStatus === "Close")return 0;
  if(!input.internal && input.asEntity === "FZCO" && input.closeOnPayment)return input.quantityMt;
  if (!input.internal || !input.closeOnPayment) return input.openMt;
  if (input.asEntity === "FZCO") return input.receivedMt > 0.000001 ? input.quantityMt : 0;
  return input.quantityMt;
}
