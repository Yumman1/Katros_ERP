import type { PaymentType } from "@/lib/trade-constants";
import type { TradeParamDefinition, TradeParamValues } from "@/lib/trade-parameters";

export function isSesameCommodity(code?: string | null, name?: string | null): boolean {
  return ["SES", "SESAME"].includes(code?.trim().toUpperCase() ?? "") || /^sesame(?:\s+seeds?)?$/i.test(name?.trim() ?? "");
}

export const SESAME_TYPES = ["Machine Cleaned", "Raw", "CNF", "Sortex", "Impurities"] as const;
export const SESAME_DEFAULTS: TradeParamValues = {
  sesameType: "Machine Cleaned", tradeRoute: "Local", purity: 99, ffa: 2,
  moisture: 7, oilContent: 49, admixture: 1,
};
export const SESAME_FIELDS: TradeParamDefinition[] = [
  { key: "sesameType", label: "Sesame type", type: "select", group: "contract", options: [...SESAME_TYPES], required: true },
  { key: "tradeRoute", label: "Trade route", type: "select", group: "logistics", options: ["Local", "Dubai"], required: true },
  ...[["purity", "Purity"], ["ffa", "FFA"], ["moisture", "Moisture"], ["oilContent", "Oil Content"], ["admixture", "Admixture"]].map(([key, label]): TradeParamDefinition => ({ key, label, type: "percent", unit: "%", group: "quality", required: true })),
  { key: "colour", label: "Color", type: "text", group: "quality", placeholder: "Type a color" },
];
export function sesameFields(values: TradeParamValues) {
  return SESAME_FIELDS.filter(d => d.key !== "colour" || values.sesameType === "Sortex");
}
export function isPercentagePayment(type: string) {
  return type === "ADVANCE_100" || type === "AFTER_DELIVERY_100";
}
/** Validate at the server boundary as well as the form. Never retain a hidden Sortex color. */
export function normalizeSesameParams(values: TradeParamValues, paymentType: PaymentType): Record<string, string | number | null> {
  const params: Record<string, string | number | null> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) params[key] = value;
  }
  if (!(SESAME_TYPES as readonly unknown[]).includes(params.sesameType)) throw new Error("Select a Sesame type");
  if (params.tradeRoute !== "Local" && params.tradeRoute !== "Dubai") throw new Error("Select Local or Dubai as the trade route");
  for (const key of ["purity", "ffa", "moisture", "oilContent", "admixture"]) {
    const value = params[key];
    if (value == null || String(value).trim() === "" || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100) throw new Error(`${SESAME_FIELDS.find(d => d.key === key)?.label} must be between 0 and 100%`);
    params[key] = Number(value);
  }
  if (params.sesameType !== "Sortex") delete params.colour;
  else if (params.colour != null) params.colour = String(params.colour).trim();
  if (isPercentagePayment(paymentType)) {
    const value = params.paymentPercentage ?? 100;
    if (!Number.isFinite(Number(value)) || Number(value) <= 0 || Number(value) > 100) throw new Error("Payment percentage must be greater than 0 and at most 100");
    params.paymentPercentage = Number(value);
  } else delete params.paymentPercentage;
  delete params.advancePercentage;
  delete params.afterDeliveryPercentage;
  return params;
}
