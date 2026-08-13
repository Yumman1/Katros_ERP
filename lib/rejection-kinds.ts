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
  CHANGE_REQUEST_EXECUTION: "Team change request",
  CHANGE_REQUEST_CEO: "Change request — CEO",
  DO_EXECUTION: "Delivery order — execution",
  DO_FINANCE: "Delivery order — finance",
};

/** Sub-filters on the execution approvals hub Rejections tab. */
export const EXECUTION_REJECTION_FILTERS = {
  team: ["CHANGE_REQUEST_EXECUTION", "CHANGE_REQUEST_CEO"],
  do: ["DO_EXECUTION", "DO_FINANCE"],
  operations: [
    "VOUCHER",
    "PAYMENT",
    "SELL_RELEASE_TRADER",
    "SELL_RELEASE_CEO",
    "INBOUND_OVER_TRADER",
    "INBOUND_OVER_CEO",
    "TRADE_SETTLEMENT",
  ],
} as const;

export function humanizeRejectionKind(kind: string): string {
  if (kind in REJECTION_KIND_LABELS) return REJECTION_KIND_LABELS[kind];
  const words = kind.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
