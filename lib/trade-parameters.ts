import { SESAME_FIELDS } from "@/lib/sesame";
/**
 * Trade-parameter model aligned with the Kastros trade file.
 *
 * - UNIVERSAL fields: same on every trade — rendered once in "Contract details"
 * - COMMODITY fields: only for the selected product — no default grain fallback
 */

export type TradeParamType = "text" | "number" | "percent" | "select" | "date" | "textarea";

export type TradeParamGroup = "contract" | "quality" | "logistics" | "commercial";

export type TradeParamDefinition = {
  key: string;
  label: string;
  type: TradeParamType;
  group: TradeParamGroup;
  options?: string[];
  placeholder?: string;
  unit?: string;
  required?: boolean;
};

export type TradeParamValues = Record<string, string | number | null | undefined>;

export const TRADE_PARAM_GROUP_LABELS: Record<TradeParamGroup, string> = {
  contract: "Contract",
  quality: "Quality",
  logistics: "Logistics",
  commercial: "Commercial",
};

/**
 * Universal fields — shown once for every trade in "Contract details".
 * NOT duplicated elsewhere in the form (counterparty, qty, price, incoterms,
 * delivery dates, origin, warehouse, grade, and product origin are first-class form fields).
 */
export const UNIVERSAL_TRADE_FIELDS: TradeParamDefinition[] = [
  {
    key: "brokerName",
    label: "Broker",
    type: "text",
    group: "contract",
    placeholder: "Name or Direct",
  },
  {
    key: "brokerNtn",
    label: "Broker NTN / CNIC",
    type: "text",
    group: "contract",
    placeholder: "N/A if direct",
  },
  {
    key: "strategyGroup",
    label: "Strategy group",
    type: "select",
    group: "commercial",
    options: ["Origination", "Distribution", "Hedging", "Other"],
  },
  {
    key: "contractStatus",
    label: "Signed contract",
    type: "select",
    group: "contract",
    options: ["Received", "to be sent", "Pending"],
  },
  {
    key: "exportContractNo",
    label: "Export contract #",
    type: "text",
    group: "contract",
    placeholder: "International sales only",
  },
  {
    key: "contactPerson",
    label: "Contact person",
    type: "text",
    group: "contract",
  },
  {
    key: "otherTerms",
    label: "Other terms",
    type: "textarea",
    group: "commercial",
    placeholder: "Payment before lifting, quality spec, etc.",
  },
];

const GRAIN_QUALITY: TradeParamDefinition[] = [
  { key: "moisture", label: "Moisture", type: "percent", group: "quality", placeholder: "e.g. 15% Max" },
  { key: "foreignMatter", label: "Foreign matter", type: "percent", group: "quality", placeholder: "e.g. 1.5% Max" },
  { key: "damaged", label: "Damaged", type: "percent", group: "quality", placeholder: "e.g. 1% Max" },
  { key: "admixture", label: "Admixture", type: "percent", group: "quality", placeholder: "e.g. 1.5% Max" },
  { key: "broken", label: "Broken", type: "percent", group: "quality", placeholder: "e.g. 2% Max" },
  { key: "aflatoxin", label: "Aflatoxin", type: "text", group: "quality", unit: "PPB", placeholder: "Max 20 PPB" },
];

/** Commodity-specific fields only — empty default (no grain fields unless commodity matches). */
export const COMMODITY_PARAM_TEMPLATES: Record<string, TradeParamDefinition[]> = {
  CRN: [],
  WHT: GRAIN_QUALITY,
  COR: GRAIN_QUALITY,
  CORN: GRAIN_QUALITY,
  WHEAT: GRAIN_QUALITY,
  SES: SESAME_FIELDS,
  SESAME: SESAME_FIELDS,
  CTN: [
    { key: "pakkaSta", label: "Pakka / STA", type: "select", group: "contract", options: ["Pakka", "STA"] },
    { key: "cropYear", label: "Crop year (CY)", type: "text", group: "quality", placeholder: "2025-2026" },
    { key: "trash", label: "Trash", type: "percent", group: "quality" },
    { key: "moisture", label: "Moisture", type: "percent", group: "quality" },
    { key: "loadingStation", label: "Loading station", type: "text", group: "logistics" },
    { key: "region", label: "Region", type: "text", group: "logistics" },
  ],
  CM: [
    { key: "moisture", label: "Moisture", type: "percent", group: "quality" },
    { key: "protein", label: "Protein", type: "percent", group: "quality" },
    { key: "kohSolubility", label: "KOH solubility", type: "percent", group: "quality" },
  ],
  SBM: [
    { key: "moisture", label: "Moisture", type: "percent", group: "quality" },
    { key: "protein", label: "Protein", type: "percent", group: "quality" },
    { key: "kohSolubility", label: "KOH solubility", type: "percent", group: "quality" },
  ],
  RAP: [
    { key: "moisture", label: "Moisture", type: "percent", group: "quality" },
    { key: "foreignMatter", label: "Foreign matter", type: "percent", group: "quality" },
    { key: "oilContent", label: "Oil content", type: "percent", group: "quality" },
    { key: "priceBaseEqu10", label: "Price base (equ 10%)", type: "number", group: "commercial" },
  ],
  RAPESEED: [
    { key: "moisture", label: "Moisture", type: "percent", group: "quality" },
    { key: "foreignMatter", label: "Foreign matter", type: "percent", group: "quality" },
    { key: "oilContent", label: "Oil content", type: "percent", group: "quality" },
  ],
  PALM: [
    { key: "vesselName", label: "Vessel name", type: "text", group: "logistics", placeholder: "Local / vessel" },
    { key: "gstTerms", label: "GST / tax terms", type: "text", group: "commercial" },
    { key: "qualitySpec", label: "Quality spec", type: "text", group: "quality", placeholder: "PORAM Spec" },
    { key: "tolerancePct", label: "Tolerance", type: "text", group: "contract", placeholder: "+/-2%" },
  ],
};

function matchCommodityTemplate(code: string): TradeParamDefinition[] {
  const upper = code.trim().toUpperCase();
  if (COMMODITY_PARAM_TEMPLATES[upper]) return COMMODITY_PARAM_TEMPLATES[upper];

  // Longest-prefix match (CORN before COR); short keys (≤3 chars) must match exactly.
  const keys = Object.keys(COMMODITY_PARAM_TEMPLATES).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (key.length <= 3) {
      if (upper === key) return COMMODITY_PARAM_TEMPLATES[key];
      continue;
    }
    if (upper.startsWith(key)) return COMMODITY_PARAM_TEMPLATES[key];
  }
  return [];
}

function dedupeParams(defs: TradeParamDefinition[]): TradeParamDefinition[] {
  const seen = new Set<string>();
  return defs.filter((p) => {
    if (seen.has(p.key)) return false;
    seen.add(p.key);
    return true;
  });
}

/** Commodity-only params (quality / logistics extras). Empty when no template matches. */
export function resolveCommoditySpecificParameters(
  commodityCode: string | undefined,
  customDefs: TradeParamDefinition[] | null | undefined,
): TradeParamDefinition[] {
  const code = commodityCode ?? "";
  return dedupeParams([...matchCommodityTemplate(code), ...(customDefs ?? [])]);
}

/** Full param set for persistence (universal + commodity + session custom). */
export function resolveAllTradeParameters(
  commodityCode: string | undefined,
  customDefs: TradeParamDefinition[] | null | undefined,
  sessionCustom: TradeParamDefinition[] = [],
): TradeParamDefinition[] {
  const commodity = resolveCommoditySpecificParameters(commodityCode, customDefs);
  const commodityKeys = new Set(commodity.map((p) => p.key));
  const extra = sessionCustom.filter((p) => !commodityKeys.has(p.key));
  return dedupeParams([...UNIVERSAL_TRADE_FIELDS, ...commodity, ...extra]);
}

export function qualitySummaryFromParams(values: TradeParamValues, defs: TradeParamDefinition[]): string {
  const qualityKeys = new Set(defs.filter((d) => d.group === "quality").map((d) => d.key));
  const parts: string[] = [];
  for (const [key, val] of Object.entries(values)) {
    if (!qualityKeys.has(key) || val == null || val === "") continue;
    const def = defs.find((d) => d.key === key);
    const label = def?.label ?? key;
    const suffix = def?.unit ? ` ${def.unit}` : def?.type === "percent" ? "%" : "";
    parts.push(`${label}: ${val}${suffix}`);
  }
  return parts.length ? parts.join("; ") : "As per contract / grade specification";
}
