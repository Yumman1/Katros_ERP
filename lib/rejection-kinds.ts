/**
 * Rejection kinds grouped to match the Approvals tabs, so a turned-down request
 * is found under the same heading the request itself lived under.
 *
 * Kinds outside these groups (voucher, payment, release-on-credit, settlement)
 * are reachable on the All tab.
 */
export const REJECTION_TAB_KINDS = {
  /** CEO turned down an edit / delete / close / cancel request on a trade. */
  tradeChanges: ["TRADE_CHANGE_CEO"],
  /** Either step of the over-delivery chain said no. */
  overDelivery: ["INBOUND_OVER_TRADER", "INBOUND_OVER_CEO"],
} as const;

export const REJECTION_KIND_LABELS: Record<string, string> = {
  SELL_RELEASE_TRADER: "Release on credit — trader",
  SELL_RELEASE_CEO: "Release on credit — CEO",
  INBOUND_OVER_TRADER: "Over-delivery — trader",
  INBOUND_OVER_CEO: "Over-delivery — CEO",
  TRADE_CHANGE_CEO: "Trade change — CEO",
  TRADE_SETTLEMENT: "Direct settlement",
  VOUCHER: "Voucher",
  PAYMENT: "Payment",
};

export function humanizeRejectionKind(kind: string): string {
  return REJECTION_KIND_LABELS[kind] ?? kind;
}
