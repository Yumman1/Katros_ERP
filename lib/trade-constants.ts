export type PaymentType =
  | "DP"
  | "LC"
  | "CAD"
  | "ADVANCE_100"
  | "CREDIT"
  | "CREDIT_30"
  | "AFTER_DELIVERY_100";

export type KycStatus = "VERIFIED" | "PENDING" | "EXPIRED" | "NOT_ON_FILE";

export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  DP: "D/P — Documents against Payment",
  LC: "L/C — Letter of Credit",
  CAD: "CAD — Cash Against Documents",
  ADVANCE_100: "100% Advance",
  CREDIT: "Day Credit",
  CREDIT_30: "30 Day Credit",
  AFTER_DELIVERY_100: "100% After Delivery",
};

/** Human-readable payment label; credit days are stored separately on the trade. */
export function paymentTypeLabel(type: PaymentType, creditDays?: number): string {
  if (type === "CREDIT") {
    const days = creditDays ?? 30;
    return `${days} Day Credit`;
  }
  return PAYMENT_TYPE_LABELS[type];
}

export const BOOKING_PAYMENT_TYPES: PaymentType[] = [
  "DP",
  "LC",
  "CAD",
  "ADVANCE_100",
  "CREDIT",
  "AFTER_DELIVERY_100",
];

/** Corn local trades hide D/P and CAD (international-only payment terms). */
export function paymentTypesForBooking(isCorn: boolean, scope: TradeScope): PaymentType[] {
  if (isCorn && scope === "LOCAL") {
    return BOOKING_PAYMENT_TYPES.filter((p) => p !== "DP" && p !== "CAD");
  }
  return BOOKING_PAYMENT_TYPES;
}

export function isCornCommodity(code: string | undefined | null): boolean {
  if (!code) return false;
  const upper = code.trim().toUpperCase();
  return upper === "CRN" || upper === "CORN" || upper.startsWith("CORN");
}

/** Commodity codes that always use the grain warehouse division (sq ft / MT). */
const GRAIN_COMMODITY_CODES = new Set([
  "CRN",
  "CORN",
  "WHT",
  "WHEAT",
  "RCE",
  "RICE",
  "SOY",
  "SOYBEANS",
  "MAIZE",
]);

export function isGrainCommodityCode(code: string | undefined | null): boolean {
  if (!code) return false;
  return GRAIN_COMMODITY_CODES.has(code.trim().toUpperCase()) || isCornCommodity(code);
}

export const CORN_COMMODITY_ORIGINS = ["Sindh", "Punjab"] as const;
export const CORN_DEAL_STATUS_OPTIONS = ["STA", "Pakka"] as const;

export const QUANTITY_UNITS = [
  "MT",
  "KG",
  "MAUND_40",
  "MAUND_37",
  "LB",
  "CWT",
  "BUSHEL",
  "BALE",
  "LTR",
  "BAG",
] as const;
export type QuantityUnit = (typeof QUANTITY_UNITS)[number];

export const PRICE_BASIS_OPTIONS = ["Fixed", "Index-linked"] as const;
export const CORN_PRICE_BASIS_OPTIONS = ["Fixed/Spot", "Unfixed"] as const;
export const ALL_PRICE_BASIS_OPTIONS = [
  ...PRICE_BASIS_OPTIONS,
  ...CORN_PRICE_BASIS_OPTIONS,
] as const;
export type PriceBasis = (typeof ALL_PRICE_BASIS_OPTIONS)[number];

export function priceBasisOptionsForCommodity(code: string | undefined | null): readonly string[] {
  return isCornCommodity(code) ? CORN_PRICE_BASIS_OPTIONS : PRICE_BASIS_OPTIONS;
}

/** Fixed/Spot basis requires price (and commission) at booking; Unfixed / Index-linked does not. */
export function priceBasisRequiresQuote(priceBasis: string | undefined | null): boolean {
  if (!priceBasis) return true;
  const b = priceBasis.trim();
  return b === "Fixed" || b === "Fixed/Spot";
}

export function tradeHasQuotedPrice(trade: { price?: number | null; pricePerCanonicalQty?: number | null }): boolean {
  return (trade.price ?? 0) > 0 || (trade.pricePerCanonicalQty ?? 0) > 0;
}

/** Desk terms — treated as plain incoterms alongside the standard ones. */
export const EXECUTION_INCOTERMS = ["Spot", "Delivered", "Ex-Warehouse"] as const;
export type ExecutionIncoterm = (typeof EXECUTION_INCOTERMS)[number];

export const STANDARD_INCOTERMS = ["EXW", "FCA", "FOB", "CFR", "CIF", "DAP"] as const;
export type StandardIncoterm = (typeof STANDARD_INCOTERMS)[number];

export const INCOTERMS = [...EXECUTION_INCOTERMS, ...STANDARD_INCOTERMS] as const;
export type Incoterm = (typeof INCOTERMS)[number];

/** Full form of every incoterm — shown wherever an incoterm is displayed or selected. */
export const INCOTERM_FULL_NAMES: Record<string, string> = {
  Spot: "Spot",
  Delivered: "Delivered",
  "Ex-Warehouse": "Ex-Warehouse",
  EXW: "EXW — Ex Works",
  FCA: "FCA — Free Carrier",
  FOB: "FOB — Free on Board",
  CFR: "CFR — Cost and Freight",
  CIF: "CIF — Cost, Insurance and Freight",
  DAP: "DAP — Delivered at Place",
};

const ORIGIN_ONLY_INCOTERMS = new Set<string>(["EXW", "FCA", "FOB", "Spot", "Delivered", "Ex-Warehouse"]);

export function incotermsForDirection(direction: "BUY" | "SELL"): readonly string[] {
  if (direction === "SELL") {
    return ["Ex-Warehouse", ...STANDARD_INCOTERMS];
  }
  return ["Spot", "Delivered", ...STANDARD_INCOTERMS];
}

/** Incoterms shown on the booking form — local trades use desk terms only. */
export function incotermsForBooking(
  direction: "BUY" | "SELL",
  scope: TradeScope,
  commodityCode?: string | null,
): readonly string[] {
  if (scope === "LOCAL") {
    if (isCornCommodity(commodityCode)) {
      return ["EXW", "Delivered"];
    }
    return ["Spot", "Delivered"];
  }
  return incotermsForDirection(direction);
}

export function defaultIncotermForBooking(
  direction: "BUY" | "SELL",
  scope: TradeScope,
  _commodityCode?: string | null,
): Incoterm {
  if (scope === "LOCAL") {
    return "Delivered";
  }
  return defaultIncotermForDirection(direction);
}

export function defaultIncotermForDirection(direction: "BUY" | "SELL"): Incoterm {
  return direction === "SELL" ? "Ex-Warehouse" : "Delivered";
}

/**
 * Internal desk routing only — never shown to users. Trades are categorized and
 * displayed by their actual incoterm; only the literal "Spot" incoterm routes a
 * purchase through the spot (mandi/broker) pipeline, everything else is inbound.
 */
export function buyingCategoryFromIncoterms(
  incoterms: string,
  direction: "BUY" | "SELL",
): BuyingCategory | null {
  if (direction === "SELL") return null;
  return incoterms === "Spot" ? "Spot" : "Delivered";
}

export function isDestinationRequired(incoterms: string): boolean {
  return !ORIGIN_ONLY_INCOTERMS.has(incoterms);
}

export function isOriginRequired(incoterms: string): boolean {
  return INCOTERMS.includes(incoterms as Incoterm);
}

export const EXECUTION_PROFILES = [
  "PURCHASE_DELIVERED",
  "PURCHASE_SPOT",
  "SALE_EX_WAREHOUSE",
] as const;
export type ExecutionProfile = (typeof EXECUTION_PROFILES)[number];

export const BUYING_CATEGORIES = ["Delivered", "Spot"] as const;
export type BuyingCategory = (typeof BUYING_CATEGORIES)[number];

export const TRADE_SCOPES = ["LOCAL", "INTERNATIONAL"] as const;
export type TradeScope = (typeof TRADE_SCOPES)[number];

export const TRADE_SCOPE_LABELS: Record<TradeScope, string> = {
  LOCAL: "Local",
  INTERNATIONAL: "International",
};

/** URL segment for execution desks (`local` | `international`). */
export function tradeScopeToPathSegment(scope: TradeScope): "local" | "international" {
  return scope === "LOCAL" ? "local" : "international";
}

export function tradeScopeFromPathSegment(segment: string): TradeScope | null {
  if (segment === "local") return "LOCAL";
  if (segment === "international") return "INTERNATIONAL";
  return null;
}

/** Stable pseudo-random scope for demo / backfill from trade ref. */
export function tradeScopeFromSeed(tradeRef: string): TradeScope {
  let hash = 0;
  for (const ch of tradeRef) hash = (hash + ch.charCodeAt(0)) % 100;
  return hash % 2 === 0 ? "LOCAL" : "INTERNATIONAL";
}

export function executionProfileFromTrade(
  direction: "BUY" | "SELL",
  buyingCategory?: BuyingCategory | null,
  incoterms?: string | null,
): ExecutionProfile {
  if (direction === "SELL") return "SALE_EX_WAREHOUSE";
  // The incoterm is authoritative: only a literal "Spot" purchase uses the spot
  // (mandi/broker) pipeline; every other incoterm is a regular inbound purchase.
  const category =
    (incoterms ? buyingCategoryFromIncoterms(incoterms, direction) : null) ??
    buyingCategory ??
    "Delivered";
  return category === "Spot" ? "PURCHASE_SPOT" : "PURCHASE_DELIVERED";
}

/**
 * The "type" a trade is sorted under on the execution side — always the trade's
 * own incoterm. Falls back to a profile-derived term only for legacy contracts
 * that were locked without an incoterm.
 */
export function executionTypeLabel(
  scope: TradeScope,
  profile: ExecutionProfile,
  incoterms?: string | null,
): string {
  if (incoterms) return incoterms;
  if (profile === "SALE_EX_WAREHOUSE") return "Ex-Warehouse";
  if (profile === "PURCHASE_SPOT") return "Spot";
  return "Delivered";
}

/** Full form of an incoterm, e.g. "FOB — Free on Board". */
export function executionIncotermLabel(incoterms: string): string {
  return INCOTERM_FULL_NAMES[incoterms] ?? incoterms;
}

/** Pakistan corn desk: kg per maund (40 kg variant). */
export const KG_PER_MAUND_40 = 40;
/** Alternate 37.324 kg maund (Pakistani cotton / grain convention). */
export const KG_PER_MAUND_37 = 37.324;
/** @deprecated Use KG_PER_MAUND_40 — kept for execution rate-per-maund math. */
export const KG_PER_MAUND = KG_PER_MAUND_40;

/** Display labels for counterparty master-data types. Role on a trade comes from Direction. */
export const COUNTERPARTY_TYPE_LABELS: Record<string, string> = {
  TRADING_PARTNER: "Trading partner",
  BUYER: "Buyer",
  SELLER: "Seller",
  BROKER: "Broker",
  BANK: "Bank",
};

export type QualityTolerances = {
  damagePct: number;
  brokenPct: number;
  fungusPct: number;
  foreignMatterPct: number;
  moisturePct: number;
};

export const DEFAULT_QUALITY_TOLERANCES: QualityTolerances = {
  damagePct: 0,
  brokenPct: 0.5,
  fungusPct: 0,
  foreignMatterPct: 0.5,
  moisturePct: 12,
};

export function formatQualityTolerancesSummary(t: QualityTolerances): string {
  return [
    `Damage: ${t.damagePct}%`,
    `Broken: ${t.brokenPct}%`,
    `Fungus: ${t.fungusPct}%`,
    `Foreign matters (inc dust): ${t.foreignMatterPct}%`,
    `Moisture: ${t.moisturePct}%`,
  ].join("; ");
}

export const DEFAULT_GRADES: Record<string, string[]> = {
  WHT: ["Grade A", "Grade B", "Milling", "Feed"],
  CPO: ["CP8", "CP10", "RBD Palm Olein", "FAQ"],
  SUG: ["VHP", "Raw", "Refined", "ICUMSA 45"],
  SOY: ["No.1 Yellow", "No.2 Yellow", "Non-GMO"],
  RCE: ["Basmati 1121", "IRRI-6", "Super Kernel"],
  default: ["Grade A", "FAQ", "Standard"],
};
