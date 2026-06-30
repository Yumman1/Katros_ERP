export type PaymentType = "DP" | "LC" | "CAD" | "ADVANCE_100" | "CREDIT_30";

export type KycStatus = "VERIFIED" | "PENDING" | "EXPIRED" | "NOT_ON_FILE";

export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  DP: "D/P — Documents against Payment",
  LC: "L/C — Letter of Credit",
  CAD: "CAD — Cash Against Documents",
  ADVANCE_100: "100% Advance",
  CREDIT_30: "30 Day Credit",
};

export const QUANTITY_UNITS = ["MT", "KG", "MAUND", "LB", "CWT", "BUSHEL", "BALE", "LTR", "BAG"] as const;
export type QuantityUnit = (typeof QUANTITY_UNITS)[number];

export const PRICE_BASIS_OPTIONS = ["Fixed", "Index-linked"] as const;
export type PriceBasis = (typeof PRICE_BASIS_OPTIONS)[number];

export const INCOTERMS = ["EXW", "FCA", "FOB", "CFR", "CIF", "DAP"] as const;
export type Incoterm = (typeof INCOTERMS)[number];

const ORIGIN_ONLY_INCOTERMS = new Set<Incoterm>(["EXW", "FCA", "FOB"]);

export function isDestinationRequired(incoterms: string): boolean {
  return !ORIGIN_ONLY_INCOTERMS.has(incoterms as Incoterm);
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
): ExecutionProfile {
  if (direction === "SELL") return "SALE_EX_WAREHOUSE";
  return buyingCategory === "Spot" ? "PURCHASE_SPOT" : "PURCHASE_DELIVERED";
}

/** Pakistan corn desk: kg per maund */
export const KG_PER_MAUND = 40;

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

export const DEFAULT_GRADES: Record<string, string[]> = {
  WHT: ["Grade A", "Grade B", "Milling", "Feed"],
  CPO: ["CP8", "CP10", "RBD Palm Olein", "FAQ"],
  SUG: ["VHP", "Raw", "Refined", "ICUMSA 45"],
  SOY: ["No.1 Yellow", "No.2 Yellow", "Non-GMO"],
  RCE: ["Basmati 1121", "IRRI-6", "Super Kernel"],
  default: ["Grade A", "FAQ", "Standard"],
};
