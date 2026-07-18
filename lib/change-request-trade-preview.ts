import { paymentTypeLabel } from "@/lib/trade-constants";
import { priceUnitLabel, quotedCurrencyLabel, type PriceCurrency } from "@/lib/price-units";
import { resolveAllTradeParameters } from "@/lib/trade-parameters";
import {
  parseExecutionWarehouseSplit,
  parseTraderWarehouseSelections,
} from "@/lib/warehouse-allocation";

export type TradePreviewSource = {
  tradeRef?: string;
  commodityCode?: string;
  counterparty?: {
    name?: string;
    companyNameNtn?: string | null;
    ntn?: string | null;
    address?: string | null;
    bankDetails?: string | null;
  };
  counterpartyKycStatus?: string;
  quantityEntered?: number | null;
  quantityEnteredUnit?: string | null;
  quantity?: number;
  quantityUnit?: string;
  price?: number;
  priceCurrency?: PriceCurrency | null;
  priceWeightUnit?: string | null;
  deliveryStart?: Date | string;
  deliveryEnd?: Date | string;
  incoterms?: string;
  paymentType?: string;
  originName?: string;
  productOrigin?: string;
  grade?: string;
  notes?: string | null;
  commissionAmount?: number | null;
  qualityTolerances?: string;
  qualityTolerancesDetail?: {
    damagePct: number;
    brokenPct: number;
    fungusPct: number;
    foreignMatterPct: number;
    moisturePct: number;
  } | null;
  tradeParams?: Record<string, string | number | null> | null;
};

export type PreviewRow = {
  label: string;
  before: string;
  after: string;
  changed: boolean;
};

function fmtDate(v: unknown): string {
  if (v == null || v === "") return "—";
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toISOString().slice(0, 10);
}

function fmtQty(entered: unknown, unit: unknown, fallbackQty?: unknown, fallbackUnit?: unknown): string {
  const q = entered ?? fallbackQty;
  const u = unit ?? fallbackUnit ?? "MT";
  if (q == null || q === "") return "—";
  return `${q} ${u}`;
}

function fmtPrice(
  price: unknown,
  currency: unknown,
  weightUnit: unknown,
): string {
  if (price == null || price === "") return "—";
  const c = (currency as PriceCurrency) ?? "PKR";
  const w = (weightUnit as string) ?? "MT";
  return `${price} ${priceUnitLabel({ currency: c, weightUnit: w })}`;
}

function fmtPayment(type: unknown, tradeParams?: Record<string, unknown> | null): string {
  if (type == null || type === "") return "—";
  const t = String(type);
  const creditDays = tradeParams?.creditDays;
  const days =
    typeof creditDays === "number"
      ? creditDays
      : typeof creditDays === "string"
        ? Number(creditDays) || undefined
        : undefined;
  if (t === "CREDIT" && days) return paymentTypeLabel("CREDIT", days);
  return paymentTypeLabel(t as Parameters<typeof paymentTypeLabel>[0]) ?? t.replace(/_/g, " ");
}

function fmtCommission(amount: unknown, currency: unknown): string {
  if (amount == null || amount === "") return "—";
  const c = (currency as PriceCurrency) ?? "PKR";
  return `${Number(amount).toLocaleString()} ${quotedCurrencyLabel(c)}`;
}

function fmtQualityDetail(
  detail: unknown,
  fallbackSummary?: string | null,
): string {
  if (detail && typeof detail === "object") {
    const d = detail as TradePreviewSource["qualityTolerancesDetail"];
    return [
      `Damage ${d?.damagePct ?? 0}%`,
      `Broken ${d?.brokenPct ?? 0}%`,
      `Fungus ${d?.fungusPct ?? 0}%`,
      `Foreign ${d?.foreignMatterPct ?? 0}%`,
      `Moisture ${d?.moisturePct ?? 0}%`,
    ].join(" · ");
  }
  return fallbackSummary?.trim() || "—";
}

function fmtWarehouseSelections(v: unknown, tradeParams?: Record<string, unknown> | null): string {
  if (Array.isArray(v) && v.length) return v.map(String).join(", ");
  if (tradeParams) {
    const picks = parseTraderWarehouseSelections(tradeParams as Record<string, string | number | null>);
    if (picks.length) return picks.join(", ");
  }
  return "—";
}

function fmtWarehouseSplit(v: unknown, tradeParams?: Record<string, unknown> | null): string {
  if (Array.isArray(v) && v.length) {
    return v
      .map((line) => {
        const l = line as { warehouseName?: string; openQtyMt?: number };
        return `${l.warehouseName ?? "?"}: ${l.openQtyMt ?? 0} MT`;
      })
      .join(" · ");
  }
  if (tradeParams) {
    const split = parseExecutionWarehouseSplit(tradeParams as Record<string, string | number | null>);
    if (split.length) {
      return split.map((l) => `${l.warehouseName}: ${l.openQtyMt} MT`).join(" · ");
    }
  }
  return "—";
}

function fmtTradeParams(
  params: Record<string, unknown> | null | undefined,
  commodityCode?: string,
): string {
  if (!params || !Object.keys(params).length) return "—";
  const defs = commodityCode ? resolveAllTradeParameters(commodityCode, null) : [];
  const labelOf = (key: string) => defs.find((d) => d.key === key)?.label ?? key.replace(/_/g, " ");
  const skip = new Set([
    "warehouse",
    "warehouseSelections",
    "executionWarehouseSplit",
    "creditDays",
  ]);
  const lines = Object.entries(params)
    .filter(([k, v]) => !skip.has(k) && v != null && v !== "")
    .map(([k, v]) => `${labelOf(k)}: ${v}`);
  return lines.length ? lines.join(" · ") : "—";
}

function readPayload(payload: Record<string, unknown>) {
  const counterparty =
    payload.counterparty && typeof payload.counterparty === "object"
      ? (payload.counterparty as Record<string, unknown>)
      : null;
  return {
    quantityEntered: payload.quantityEntered,
    quantityEnteredUnit: payload.quantityEnteredUnit,
    price: payload.price,
    priceCurrency: payload.priceCurrency,
    priceWeightUnit: payload.priceWeightUnit,
    deliveryStart: payload.deliveryStart,
    deliveryEnd: payload.deliveryEnd,
    incoterms: payload.incoterms,
    paymentType: payload.paymentType,
    creditDays: payload.creditDays,
    originName: payload.originName,
    productOrigin: payload.productOrigin,
    grade: payload.grade,
    notes: payload.notes,
    commissionAmount: payload.commissionAmount,
    qualityTolerancesDetail: payload.qualityTolerancesDetail,
    tradeParams: payload.tradeParams as Record<string, unknown> | undefined,
    warehouseSelections: payload.warehouseSelections,
    warehouseSplit: payload.warehouseSplit,
    executionEditNote: payload.executionEditNote,
    counterpartyName: counterparty?.name,
    counterpartyCompanyNameNtn: counterparty?.companyNameNtn,
    counterpartyNtn: counterparty?.ntn,
    counterpartyAddress: counterparty?.address,
    counterpartyBankDetails: counterparty?.bankDetails,
    counterpartyVerify: counterparty?.verify === true,
  };
}

function readCurrent(current: TradePreviewSource) {
  const creditDays = current.tradeParams?.creditDays;
  return {
    quantityEntered: current.quantityEntered ?? current.quantity,
    quantityEnteredUnit: current.quantityEnteredUnit ?? current.quantityUnit,
    price: current.price,
    priceCurrency: current.priceCurrency,
    priceWeightUnit: current.priceWeightUnit,
    deliveryStart: current.deliveryStart,
    deliveryEnd: current.deliveryEnd,
    incoterms: current.incoterms,
    paymentType: current.paymentType,
    creditDays,
    originName: current.originName,
    productOrigin: current.productOrigin,
    grade: current.grade,
    notes: current.notes,
    commissionAmount: current.commissionAmount,
    qualityTolerancesDetail: current.qualityTolerancesDetail,
    tradeParams: current.tradeParams as Record<string, unknown> | undefined,
    warehouseSelections: parseTraderWarehouseSelections(current.tradeParams ?? null),
    warehouseSplit: parseExecutionWarehouseSplit(current.tradeParams ?? null),
    executionEditNote: null,
    counterpartyName: current.counterparty?.name,
    counterpartyCompanyNameNtn: current.counterparty?.companyNameNtn,
    counterpartyNtn: current.counterparty?.ntn,
    counterpartyAddress: current.counterparty?.address,
    counterpartyBankDetails: current.counterparty?.bankDetails,
    counterpartyKycStatus: current.counterpartyKycStatus,
  };
}

function row(label: string, before: string, after: string): PreviewRow {
  const changed = before !== after;
  return { label, before, after, changed };
}

/** Build human-readable before/after rows for an open-trade edit approval. */
export function buildTradeEditPreviewRows(
  current: TradePreviewSource | null | undefined,
  payload: Record<string, unknown>,
): PreviewRow[] {
  const p = readPayload(payload);
  const c = current ? readCurrent(current) : null;
  const commodityCode = current?.commodityCode;

  const mergedParams = (base?: Record<string, unknown> | null, extra?: Record<string, unknown>) => {
    const out = { ...(base ?? {}) };
    if (p.creditDays != null) out.creditDays = p.creditDays;
    if (extra) Object.assign(out, extra);
    return Object.keys(out).length ? out : null;
  };

  const rows: PreviewRow[] = [
    row(
      "Quantity",
      c ? fmtQty(c.quantityEntered, c.quantityEnteredUnit) : "—",
      fmtQty(p.quantityEntered, p.quantityEnteredUnit),
    ),
    row(
      "Price",
      c ? fmtPrice(c.price, c.priceCurrency, c.priceWeightUnit) : "—",
      fmtPrice(p.price, p.priceCurrency, p.priceWeightUnit),
    ),
    row("Delivery start", c ? fmtDate(c.deliveryStart) : "—", fmtDate(p.deliveryStart)),
    row("Delivery end", c ? fmtDate(c.deliveryEnd) : "—", fmtDate(p.deliveryEnd)),
    row("Incoterm", c?.incoterms?.trim() || "—", String(p.incoterms ?? "—")),
    row(
      "Payment",
      c ? fmtPayment(c.paymentType, mergedParams(c.tradeParams)) : "—",
      fmtPayment(p.paymentType, mergedParams(p.tradeParams as Record<string, unknown>)),
    ),
    row("Grade", c?.grade?.trim() || "—", String(p.grade ?? "—").trim() || "—"),
    row("Product origin", c?.productOrigin?.trim() || "—", String(p.productOrigin ?? "—").trim() || "—"),
    row("Origin / location", c?.originName?.trim() || "—", String(p.originName ?? "—").trim() || "—"),
    row(
      "Commission",
      c ? fmtCommission(c.commissionAmount, c.priceCurrency) : "—",
      fmtCommission(p.commissionAmount, p.priceCurrency),
    ),
    row(
      "Quality specification",
      c ? fmtQualityDetail(c.qualityTolerancesDetail, current?.qualityTolerances) : "—",
      fmtQualityDetail(p.qualityTolerancesDetail),
    ),
    row(
      "Contract details",
      c ? fmtTradeParams(c.tradeParams ?? null, commodityCode) : "—",
      fmtTradeParams(p.tradeParams ?? null, commodityCode),
    ),
    row(
      "Trader warehouse picks",
      c ? fmtWarehouseSelections(c.warehouseSelections, c.tradeParams ?? null) : "—",
      fmtWarehouseSelections(p.warehouseSelections, p.tradeParams ?? null),
    ),
    row(
      "Warehouse allocation split",
      c ? fmtWarehouseSplit(c.warehouseSplit, c.tradeParams ?? null) : "—",
      fmtWarehouseSplit(p.warehouseSplit, p.tradeParams ?? null),
    ),
    row("Notes", c?.notes?.trim() || "—", p.notes ? String(p.notes).trim() : "—"),
    row(
      "Counterparty name",
      c?.counterpartyName?.trim() || "—",
      p.counterpartyName != null ? String(p.counterpartyName).trim() || "—" : "—",
    ),
    row(
      "Company name (NTN)",
      c?.counterpartyCompanyNameNtn?.trim() || "—",
      p.counterpartyCompanyNameNtn != null
        ? String(p.counterpartyCompanyNameNtn).trim() || "—"
        : "—",
    ),
    row(
      "NTN no.",
      c?.counterpartyNtn?.trim() || "—",
      p.counterpartyNtn != null ? String(p.counterpartyNtn).trim() || "—" : "—",
    ),
    row(
      "Counterparty address",
      c?.counterpartyAddress?.trim() || "—",
      p.counterpartyAddress != null ? String(p.counterpartyAddress).trim() || "—" : "—",
    ),
    row(
      "Bank details",
      c?.counterpartyBankDetails?.trim() || "—",
      p.counterpartyBankDetails != null ? String(p.counterpartyBankDetails).trim() || "—" : "—",
    ),
  ];

  if (p.executionEditNote) {
    rows.push(
      row(
        "Note to trader",
        "—",
        String(p.executionEditNote),
      ),
    );
  }

  if (p.counterpartyVerify) {
    rows.push(
      row(
        "Counterparty KYC",
        c?.counterpartyKycStatus?.trim() || "—",
        "VERIFIED (portal check)",
      ),
    );
  }

  return rows;
}

export function countChangedRows(rows: PreviewRow[]): number {
  return rows.filter((r) => r.changed).length;
}
