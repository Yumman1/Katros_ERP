import { mockAllTraderTrades } from "@/server/dummy-data";
import type { MockTraderTrade } from "@/server/dummy-data";

export type TradeFileFilter = {
  from?: Date;
  to?: Date;
  commodityCode?: string;
  counterpartyId?: string;
  counterpartyName?: string;
  direction?: "BUY" | "SELL";
  tradeScope?: "LOCAL" | "INTERNATIONAL";
  tradeStatus?: string;
  incoterms?: string;
  traderName?: string;
};

function csvCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  return x.toISOString().slice(0, 10);
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export function filterTradesForTradeFile(
  trades: MockTraderTrade[],
  filter?: TradeFileFilter,
): MockTraderTrade[] {
  if (!filter) return trades;
  const to = filter.to ? endOfDay(filter.to) : null;
  return trades.filter((t) => {
    const booked = new Date(t.tradeDate);
    if (filter.from && booked < filter.from) return false;
    if (to && booked > to) return false;
    if (filter.commodityCode && t.commodity.code !== filter.commodityCode) return false;
    if (filter.counterpartyId && t.counterparty.id !== filter.counterpartyId) return false;
    if (
      filter.counterpartyName &&
      t.counterparty.name.toLowerCase() !== filter.counterpartyName.toLowerCase()
    )
      return false;
    if (filter.direction && t.direction !== filter.direction) return false;
    if (filter.tradeScope && t.tradeScope !== filter.tradeScope) return false;
    if (filter.tradeStatus && t.tradeStatus !== filter.tradeStatus) return false;
    if (filter.incoterms && t.incoterms !== filter.incoterms) return false;
    if (
      filter.traderName &&
      t.traderName.toLowerCase() !== filter.traderName.toLowerCase()
    )
      return false;
    return true;
  });
}

const CORE_HEADERS = [
  "tradeRef",
  "tradeDate",
  "lockedAt",
  "lockedBy",
  "traderName",
  "desk",
  "direction",
  "tradeStatus",
  "tradeScope",
  "executionProfile",
  "incoterms",
  "buyingCategory",
  "commodityCode",
  "commodityName",
  "counterpartyName",
  "counterpartyCode",
  "counterpartyNtn",
  "counterpartyAddress",
  "counterpartyBankDetails",
  "grade",
  "productOrigin",
  "quantity",
  "quantityUnit",
  "quantityEntered",
  "quantityEnteredUnit",
  "price",
  "priceCurrency",
  "priceWeightUnit",
  "priceKgPerUnit",
  "pricePerCanonicalQty",
  "currency",
  "ratePerMaund",
  "ratePerKg",
  "commissionAmount",
  "commissionPerMaund",
  "commissionPerUnit",
  "priceBasis",
  "paymentType",
  "paymentTerms",
  "deliveryStart",
  "deliveryEnd",
  "originName",
  "destName",
  "qualityTolerances",
  "maxMoisturePct",
  "damagePct",
  "brokenPct",
  "fungusPct",
  "foreignMatterPct",
  "moisturePct",
  "notes",
  "marketPrice",
  "mtmPnl",
  "contractRef",
  "counterpartyKycStatus",
  "counterpartyKycRef",
] as const;

function coreRow(t: MockTraderTrade): (string | number)[] {
  const q = t.qualityTolerancesDetail;
  return [
    t.tradeRef,
    fmtDate(t.tradeDate),
    fmtDate(t.lockedAt),
    t.lockedBy ?? "",
    t.traderName,
    t.desk,
    t.direction,
    t.tradeStatus,
    t.tradeScope ?? "",
    t.executionProfile ?? "",
    t.incoterms,
    t.buyingCategory ?? "",
    t.commodity.code,
    t.commodity.name,
    t.counterparty.name,
    t.counterparty.code,
    t.counterparty.ntn ?? "",
    t.counterparty.address ?? "",
    t.counterparty.bankDetails ?? "",
    t.grade,
    t.productOrigin,
    t.quantity,
    t.quantityUnit,
    t.quantityEntered ?? "",
    t.quantityEnteredUnit ?? "",
    t.price,
    t.priceCurrency ?? t.currency,
    t.priceWeightUnit ?? "",
    t.priceKgPerUnit ?? "",
    t.pricePerCanonicalQty ?? "",
    t.currency,
    t.ratePerMaund ?? "",
    t.ratePerKg ?? "",
    t.commissionAmount ?? "",
    t.commissionPerMaund ?? "",
    t.commissionPerUnit ?? "",
    t.priceBasis,
    t.paymentType,
    t.paymentTerms,
    fmtDate(t.deliveryStart),
    fmtDate(t.deliveryEnd),
    t.originName,
    t.destName,
    t.qualityTolerances,
    t.maxMoisturePct ?? "",
    q?.damagePct ?? "",
    q?.brokenPct ?? "",
    q?.fungusPct ?? "",
    q?.foreignMatterPct ?? "",
    q?.moisturePct ?? "",
    t.notes ?? "",
    t.marketPrice,
    t.mtmPnl,
    t.contractRef ?? "",
    t.counterpartyKycStatus,
    t.counterpartyKycRef ?? "",
  ];
}

/** Full trade file CSV — every booking field plus flattened tradeParams. */
export function exportTradeFileCsv(filter?: TradeFileFilter): string {
  const trades = filterTradesForTradeFile(mockAllTraderTrades(), filter);

  const paramKeys = new Set<string>();
  for (const t of trades) {
    if (t.tradeParams) {
      for (const k of Object.keys(t.tradeParams)) paramKeys.add(k);
    }
  }
  const sortedParams = [...paramKeys].sort();
  const paramHeaders = sortedParams.map((k) => `param_${k}`);
  const headers = [...CORE_HEADERS, ...paramHeaders];

  const lines = [headers.join(",")];
  for (const t of trades) {
    const params = sortedParams.map((k) => {
      const v = t.tradeParams?.[k];
      return v == null ? "" : v;
    });
    const row = [...coreRow(t), ...params].map(csvCell);
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

export function tradeFileFilterOptions() {
  const trades = mockAllTraderTrades();
  const commodities = new Map<string, string>();
  const counterparties = new Map<string, string>();
  const traders = new Set<string>();
  const incoterms = new Set<string>();
  const statuses = new Set<string>();

  for (const t of trades) {
    commodities.set(t.commodity.code, t.commodity.name);
    counterparties.set(t.counterparty.id, t.counterparty.name);
    traders.add(t.traderName);
    incoterms.add(t.incoterms);
    statuses.add(t.tradeStatus);
  }

  return {
    commodities: [...commodities.entries()]
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    counterparties: [...counterparties.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    traders: [...traders].sort(),
    incoterms: [...incoterms].sort(),
    statuses: [...statuses].sort(),
  };
}

export function previewTradeFile(filter?: TradeFileFilter) {
  const trades = filterTradesForTradeFile(mockAllTraderTrades(), filter);
  return {
    count: trades.length,
    trades: trades.slice(0, 25).map((t) => ({
      tradeRef: t.tradeRef,
      tradeDate: t.tradeDate,
      counterpartyName: t.counterparty.name,
      commodityCode: t.commodity.code,
      direction: t.direction,
      tradeStatus: t.tradeStatus,
      quantity: t.quantity,
      quantityUnit: t.quantityUnit,
    })),
  };
}
