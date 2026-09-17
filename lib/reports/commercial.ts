/** Pure reporting calculations. These never create allocations or ledger posts. */
export type ReportMovement = {
  id: string; date: string; direction: "BUY" | "SELL";
  tradeRef: string; traderName: string; commodityId: string; commodity: string;
  counterpartyId: string; counterparty: string; warehouse: string;
  quantityKg: number | null; amount: number | null; currency: string;
  batchRefs: string[]; invalidBatchLink: boolean; reference: string;
};
export type CostedSale = ReportMovement & {
  purchaseCost: number | null; profit: number | null; costReason: string;
  purchaseRefs: string[];
};
export type ReportFilters = {
  from: string; to: string; basis: "delivered" | "booked";
  groupBy: "week" | "month" | "year";
  commodityId?: string; counterpartyId?: string; warehouse?: string;
};

export const roundMoney = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const pakistanDay = (iso: string) => new Date(new Date(iso).getTime() + 5 * 3600_000).toISOString().slice(0, 10);
export function periodKey(day: string, groupBy: ReportFilters["groupBy"]) {
  if (groupBy === "year") return day.slice(0, 4);
  if (groupBy === "month") return day.slice(0, 7);
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return d.toISOString().slice(0, 10);
}

export function previousReportRange(filters: Pick<ReportFilters, "from" | "to">) {
  const start = new Date(`${filters.from}T00:00:00Z`);
  const end = new Date(`${filters.to}T00:00:00Z`);
  const previousEnd = new Date(start.getTime() - 86400_000);
  const nextMonth = new Date(start); nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const nextYear = new Date(start); nextYear.setUTCFullYear(nextYear.getUTCFullYear() + 1);
  const afterEnd = end.getTime() + 86400_000;
  const previousStart = new Date(start);
  if (start.getUTCDate() === 1 && start.getUTCMonth() === 0 && afterEnd === nextYear.getTime()) previousStart.setUTCFullYear(start.getUTCFullYear() - 1);
  else if (start.getUTCDate() === 1 && afterEnd === nextMonth.getTime()) previousStart.setUTCMonth(start.getUTCMonth() - 1);
  else previousStart.setTime(start.getTime() - (afterEnd - start.getTime()));
  return { from: previousStart.toISOString().slice(0, 10), to: previousEnd.toISOString().slice(0, 10) };
}

/** Moving weighted-average cost within an explicitly linked batch. Replay all
 * history before filtering, so partial sales and earlier periods consume cost.
 * Multi-batch links lack quantities: never split or invent an allocation. */
export function costBatchSales(movements: ReportMovement[]): CostedSale[] {
  type Pool = { quantity: number; value: number; refs: Set<string>; currency: string; commodityId: string; blocked: string | null };
  const pools = new Map<string, Pool>();
  const result: CostedSale[] = [];
  const events = [...movements].sort((a, b) => a.date.localeCompare(b.date)
    || (a.direction === b.direction ? a.id.localeCompare(b.id) : a.direction === "BUY" ? -1 : 1));
  for (const m of events) {
    const refs = [...new Set(m.batchRefs)];
    const issue = m.invalidBatchLink ? "Batch commodity does not match trade"
      : refs.length !== 1 ? (refs.length ? "Multiple batches: quantity allocation required" : "No batch linked")
      : m.quantityKg == null || m.quantityKg <= 0 ? "Quantity or unit conversion missing"
      : m.amount == null ? "Recorded value missing" : null;
    if (refs.length !== 1 || m.invalidBatchLink) {
      for (const ref of refs) {
        const pool = pools.get(ref) ?? { quantity: 0, value: 0, refs: new Set<string>(), currency: m.currency, commodityId: m.commodityId, blocked: null };
        pool.blocked = issue;
        pools.set(ref, pool);
      }
      if (m.direction === "SELL") result.push({ ...m, purchaseCost: null, profit: null, purchaseRefs: [], costReason: issue! });
      continue;
    }
    const ref = refs[0];
    const pool = pools.get(ref) ?? { quantity: 0, value: 0, refs: new Set<string>(), currency: m.currency, commodityId: m.commodityId, blocked: null };
    if (pool.currency !== m.currency) pool.blocked = "Purchase and sale currencies differ";
    if (pool.commodityId !== m.commodityId) pool.blocked = "Batch commodity does not match trade";
    if (m.direction === "BUY") {
      if (issue) pool.blocked = issue;
      else {
        if (pool.quantity <= 0.000001) pool.refs.clear();
        pool.quantity += m.quantityKg!;
        pool.value += m.amount!;
        pool.refs.add(m.reference);
      }
    } else {
      const reason = pool.blocked ?? issue ?? (pool.quantity + 0.000001 < m.quantityKg! || pool.quantity <= 0 ? "Insufficient linked purchase quantity before sale" : null);
      const cost = reason ? null : pool.value * m.quantityKg! / pool.quantity;
      result.push({ ...m, purchaseCost: cost == null ? null : roundMoney(cost), profit: cost == null ? null : roundMoney(m.amount! - cost),
        purchaseRefs: cost == null ? [] : [...pool.refs], costReason: reason ?? "Linked batch · moving weighted-average receipt cost" });
      if (cost != null) { pool.quantity = Math.max(0, pool.quantity - m.quantityKg!); pool.value = Math.max(0, pool.value - cost); }
      else {
        // The uncosted sale still consumed stock. Do not reuse that stock later.
        pool.blocked = reason;
      }
    }
    pools.set(ref, pool);
  }
  return result;
}

export function buildCommercialReport(movements: ReportMovement[], filters: ReportFilters, traderName?: string) {
  const salesById = new Map((filters.basis === "delivered" ? costBatchSales(movements) : []).map((r) => [r.id, r]));
  const scoped = movements.filter((m) => traderName === undefined || m.traderName === traderName);
  const options = {
    commodities: [...new Map(scoped.map((m) => [m.commodityId, { id: m.commodityId, name: m.commodity }])).values()].sort((a, b) => a.name.localeCompare(b.name)),
    counterparties: [...new Map(scoped.map((m) => [m.counterpartyId, { id: m.counterpartyId, name: m.counterparty }])).values()].sort((a, b) => a.name.localeCompare(b.name)),
    warehouses: [...new Set(scoped.map((m) => m.warehouse).filter(Boolean))].sort(),
  };
  const inScope = (m: ReportMovement, from: string, to: string) => {
    const day = pakistanDay(m.date);
    return day >= from && day <= to
      && (!filters.commodityId || m.commodityId === filters.commodityId)
      && (!filters.counterpartyId || m.counterpartyId === filters.counterpartyId)
      && (!filters.warehouse || m.warehouse === filters.warehouse);
  };
  const rows = scoped.filter((m) => inScope(m, filters.from, filters.to));
  const previousRange = previousReportRange(filters);
  const previousRows = scoped.filter((m) => inScope(m, previousRange.from, previousRange.to));
  const sales: CostedSale[] = rows.filter((m) => m.direction === "SELL").map((m) => salesById.get(m.id)
    ?? { ...m, purchaseCost: null, profit: null, purchaseRefs: [], costReason: "Booked values: batch profit is available for delivered sales" });
  const summarize = (subset: ReportMovement[], commodity: string, currency: string, period: string) => {
    const buys = subset.filter((m) => m.direction === "BUY");
    const sells = subset.filter((m) => m.direction === "SELL");
    const costed = sells.map((s) => salesById.get(s.id)).filter((s): s is CostedSale => !!s && s.purchaseCost != null);
    const sum = (list: ReportMovement[], key: "quantityKg" | "amount") => list.reduce((n, r) => n + (r[key] ?? 0), 0);
    const purchaseValue = roundMoney(sum(buys, "amount"));
    const salesValue = roundMoney(sum(sells, "amount"));
    const missingValues = subset.filter((r) => r.amount == null).length;
    const missingQuantities = subset.filter((r) => r.quantityKg == null).length;
    const cost = roundMoney(costed.reduce((n, r) => n + r.purchaseCost!, 0));
    const matchedSales = roundMoney(costed.reduce((n, r) => n + r.amount!, 0));
    const profit = roundMoney(matchedSales - cost);
    return { commodity, currency, period, purchaseQtyMt: sum(buys, "quantityKg") / 1000, salesQtyMt: sum(sells, "quantityKg") / 1000,
      purchaseValue, salesValue, purchaseMinusSales: missingValues ? null : roundMoney(purchaseValue - salesValue),
      averageSellingPrice: sells.some((r) => r.amount == null || r.quantityKg == null) || !sum(sells, "quantityKg") ? null : salesValue / (sum(sells, "quantityKg") / 1000),
      purchaseCost: cost, matchedSales, matchedProfit: profit, profit: costed.length === sells.length && sells.length > 0 ? profit : null,
      marginPct: matchedSales > 0 ? profit / matchedSales * 100 : null,
      salesCount: sells.length, costedCount: costed.length, uncostedCount: sells.length - costed.length, missingValues, missingQuantities };
  };
  const group = (withPeriod: boolean, records: ReportMovement[] = rows) => {
    const buckets = new Map<string, ReportMovement[]>();
    for (const r of records) {
      const key = JSON.stringify([withPeriod ? periodKey(pakistanDay(r.date), filters.groupBy) : "Total", r.commodityId, r.currency]);
      const list = buckets.get(key) ?? []; list.push(r); buckets.set(key, list);
    }
    return [...buckets.values()].map((list) => summarize(list, list[0].commodity, list[0].currency, withPeriod ? periodKey(pakistanDay(list[0].date), filters.groupBy) : "Total"))
      .sort((a, b) => a.period.localeCompare(b.period) || a.commodity.localeCompare(b.commodity) || a.currency.localeCompare(b.currency));
  };
  const previous = group(false, previousRows);
  const current = group(false);
  const comparisonRows = [...current, ...previous.filter((p) => !current.some((r) => r.commodity === p.commodity && r.currency === p.currency))
    .map((p) => ({ ...p, salesValue: 0, missingValues: 0 }))];
  const comparisons = comparisonRows.map((row) => {
    const before = previous.find((p) => p.commodity === row.commodity && p.currency === row.currency);
    const previousSales = before?.salesValue ?? 0;
    const valid = !row.missingValues && !before?.missingValues;
    return { commodity: row.commodity, currency: row.currency, sales: row.salesValue, previousSales,
      change: valid ? roundMoney(row.salesValue - previousSales) : null,
      changePct: valid && previousSales > 0 ? (row.salesValue - previousSales) / previousSales * 100 : null };
  });
  const buyerGroups = new Map<string, CostedSale[]>();
  for (const sale of sales) {
    const key = JSON.stringify([sale.counterpartyId, sale.currency]);
    const list = buyerGroups.get(key) ?? []; list.push(sale); buyerGroups.set(key, list);
  }
  const buyers = [...buyerGroups.values()].map((list) => ({
    counterparty: list[0].counterparty, counterpartyId: list[0].counterpartyId, currency: list[0].currency,
    sales: roundMoney(list.reduce((n, s) => n + (s.amount ?? 0), 0)),
    quantityMt: list.reduce((n, s) => n + (s.quantityKg ?? 0), 0) / 1000,
    count: list.length, missingValues: list.filter((s) => s.amount == null).length,
  })).sort((a, b) => a.currency.localeCompare(b.currency) || b.sales - a.sales);
  return { options, commodities: group(false), periods: group(true), sales, previousRange, comparisons, buyers,
    purchases: rows.filter((r) => r.direction === "BUY"), filters,
    generatedAt: new Date().toISOString(), scope: traderName !== undefined ? "Your trades" : "All trades" };
}
export type CommercialReport = ReturnType<typeof buildCommercialReport>;
