"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { pkToday, formatPkDateTime, formatPkDate } from "@/lib/formatters/datetime";
import { periodKey, type CommercialReport, type ReportFilters } from "@/lib/reports/commercial";
import { cn } from "@/lib/utils";

const fmt = (n: number | null, digits = 2) => n == null ? "—" : new Intl.NumberFormat("en-PK", { maximumFractionDigits: digits }).format(n);
const signed = (n: number | null) => n == null ? "—" : `${n > 0 ? "+" : ""}${fmt(n)}`;
const tone = (n: number | null) => n == null || n === 0 ? "text-subtle" : n > 0 ? "text-success" : "text-destructive";
function rangeFor(day: string, group: ReportFilters["groupBy"]) {
  const from = periodKey(day, group);
  const d = new Date(`${group === "year" ? `${from}-01-01` : group === "month" ? `${from}-01` : from}T00:00:00Z`);
  const start = d.toISOString().slice(0, 10);
  if (group === "week") d.setUTCDate(d.getUTCDate() + 6);
  if (group === "month") { d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); }
  if (group === "year") { d.setUTCFullYear(d.getUTCFullYear() + 1); d.setUTCDate(0); }
  return { from: start, to: d.toISOString().slice(0, 10) };
}

export function CommercialReportPanel({ scope = "finance", margins = false }: { scope?: "finance" | "trader"; margins?: boolean }) {
  const [filters, setFilters] = useState<ReportFilters>(() => ({ ...rangeFor(pkToday(), "month"), basis: "delivered", groupBy: "month" }));
  const [draft, setDraft] = useState(filters);
  const [anchor, setAnchor] = useState(pkToday);
  const [view, setView] = useState<"summary" | "periods" | "batches" | "purchases" | "comparison" | "buyers">("summary");
  const [search, setSearch] = useState("");
  const [saleStatus, setSaleStatus] = useState("all");
  const [page, setPage] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const finance = trpc.reports.commercial.useQuery(filters, { enabled: scope === "finance", retry: false, refetchInterval: 60_000 });
  const trader = trpc.trader.commoditySalesReport.useQuery(filters, { enabled: scope === "trader", retry: false, refetchInterval: 60_000 });
  const query = scope === "trader" ? trader : finance;
  const data = query.data;
  const sales = useMemo(() => (data?.sales ?? []).filter((s) => `${s.batchRefs.join(" ")} ${s.reference} ${s.counterparty}`.toLowerCase().includes(search.toLowerCase())
    && (saleStatus === "all" || (saleStatus === "missing" ? s.profit == null : saleStatus === "profit" ? s.profit != null && s.profit > 0 : saleStatus === "loss" ? s.profit != null && s.profit < 0 : s.profit === 0))), [data, search, saleStatus]);
  const pageCount = Math.max(1, Math.ceil(sales.length / 25));
  const safePage = Math.min(page, pageCount - 1);
  const currencyTotals = useMemo(() => {
    const totals = new Map<string, { sales: number; cost: number; profit: number; uncosted: number; missing: number; costed: number }>();
    for (const row of data?.commodities ?? []) {
      const t = totals.get(row.currency) ?? { sales: 0, cost: 0, profit: 0, uncosted: 0, missing: 0, costed: 0 };
      t.sales += row.salesValue; t.cost += row.purchaseCost; t.profit += row.matchedProfit; t.uncosted += row.uncostedCount; t.missing += row.missingValues; t.costed += row.costedCount;
      totals.set(row.currency, t);
    }
    return [...totals];
  }, [data]);
  async function exportReport(kind: "excel" | "pdf") {
    if (!data) return;
    setExportError(null);
    try {
      const { exportCommercialReport } = await import("@/lib/reports/export-commercial");
      await exportCommercialReport(data, kind);
    } catch { setExportError("Export failed. Please try again."); }
  }
  const setPreset = (groupBy: ReportFilters["groupBy"]) => {
    const next = { ...draft, groupBy, ...rangeFor(anchor || pkToday(), groupBy) };
    setDraft(next); setFilters(next); setPage(0);
  };
  return (
    <div className="shrink-0 space-y-5 pb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">{margins ? "Commercial margins" : "Commodity sales report"}</h1>
          <p className="mt-1 text-sm text-subtle">{scope === "trader" ? "Your sales and their linked batch costs." : "Commodity performance and batch purchase/sale comparisons."} Profit = sales − cost of quantity sold.</p>
        </div>
        <div className="flex gap-2"><button type="button" className="kastros-btn-secondary" disabled={!data || !!query.error || query.isFetching} onClick={() => exportReport("excel")}>Export Excel</button><button type="button" className="kastros-btn-secondary" disabled={!data || !!query.error || query.isFetching} onClick={() => exportReport("pdf")}>Export PDF</button></div>
      </div>
      <form className="exec-panel space-y-3" onSubmit={(e) => { e.preventDefault(); setFilters(draft); setPage(0); }}>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">Period containing<input type="date" className="kastros-input ml-2" value={anchor} onChange={(e) => setAnchor(e.target.value)} /></label>
          {(["week", "month", "year"] as const).map((g) => <button key={g} type="button" className="kastros-btn-secondary capitalize" onClick={() => setPreset(g)}>{g}</button>)}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">From<input required type="date" className="kastros-input block" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></label>
          <label className="text-xs">To<input required type="date" min={draft.from} className="kastros-input block" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></label>
          <label className="text-xs">Basis<select className="kastros-input block" value={draft.basis} onChange={(e) => setDraft({ ...draft, basis: e.target.value as ReportFilters["basis"], warehouse: undefined })}><option value="delivered">Received purchases / released sales</option><option value="booked">Booked contracts</option></select></label>
          <label className="text-xs">Group periods<select className="kastros-input block" value={draft.groupBy} onChange={(e) => setDraft({ ...draft, groupBy: e.target.value as ReportFilters["groupBy"] })}><option value="week">Weekly (Monday–Sunday)</option><option value="month">Monthly</option><option value="year">Yearly (calendar)</option></select></label>
          <label className="text-xs">Commodity<select className="kastros-input block" value={draft.commodityId ?? ""} onChange={(e) => setDraft({ ...draft, commodityId: e.target.value || undefined })}><option value="">All commodities</option>{data?.options.commodities.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
          <label className="text-xs">Counterparty<select className="kastros-input block" value={draft.counterpartyId ?? ""} onChange={(e) => setDraft({ ...draft, counterpartyId: e.target.value || undefined })}><option value="">All counterparties</option>{data?.options.counterparties.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
          <label className="text-xs">Warehouse<select disabled={draft.basis === "booked"} className="kastros-input block" value={draft.warehouse ?? ""} onChange={(e) => setDraft({ ...draft, warehouse: e.target.value || undefined })}><option value="">All warehouses</option>{data?.options.warehouses.map((w) => <option key={w} value={w}>{w}</option>)}</select></label>
          <button type="submit" className="kastros-btn-primary" disabled={!draft.from || !draft.to || draft.from > draft.to}>Apply filters</button>
          <button type="button" className="kastros-btn-secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh</button>
        </div>
      </form>
      {exportError && <p role="alert" className="text-destructive">{exportError}</p>}
      {query.error ? <p role="alert" className="exec-panel text-destructive">Unable to load report: {query.error.message}</p> : query.isLoading ? <p role="status">Loading report…</p> : data && <>
        <p className="text-xs text-subtle">{data.scope} · {data.filters.from} to {data.filters.to} · Asia/Karachi · {data.filters.basis === "delivered" ? "Receipt/release dates" : "Trade dates"} · Updated {formatPkDateTime(data.generatedAt)}{query.isFetching ? " · Refreshing…" : ""}</p>
        <div className="grid gap-3 md:grid-cols-2">{currencyTotals.map(([currency, t]) => <div key={currency} className="exec-panel">
          <h2 className="text-sm font-semibold">{currency}</h2><div className="mt-2 grid grid-cols-3 gap-3 text-sm">
            <div><p className="text-xs text-subtle">Sales value{t.missing ? " (known)" : ""}</p><strong>{fmt(t.sales)}</strong></div>
            <div><p className="text-xs text-subtle">Matched purchase cost</p><strong>{!t.costed ? "—" : fmt(t.cost)}</strong></div>
            <div><p className="text-xs text-subtle">{t.uncosted ? "Matched profit/loss only" : "Gross profit/loss"}</p><strong className={tone(t.profit)}>{!t.costed ? "—" : signed(t.profit)}</strong></div>
          </div><p className="mt-2 text-xs text-subtle">{t.uncosted} sales without matched cost{t.missing ? ` · ${t.missing} records without value` : ""}</p>
        </div>)}</div>
        <div className="rounded-lg border border-border p-3 text-xs text-subtle space-y-1">
          <p>Purchase − sales is the period difference you requested; purchases may include unsold stock. Gross profit uses only linked purchase cost for the quantity sold, before tax, freight, commission and overhead.</p>
          <p>Batch cost uses a moving weighted average of recorded receipts available before each sale. Missing links, multi-batch allocations, mixed currencies or insufficient quantity leave profit uncalculated. Historical purchases can fund sales in this period.</p>
          {data.filters.basis === "booked" && <p>Booked view includes locked, confirmed and executed contracts, excludes drafts/cancelled/direct-settlement trades, and does not calculate batch profit.</p>}
        </div>
        <nav aria-label="Report views" className="flex flex-wrap gap-2">{([['summary', 'Commodity summary'], ['periods', 'Period summary'], ['batches', 'Batch sales / profit & loss'], ['purchases', 'Purchase detail'], ['comparison', 'Previous period'], ['buyers', 'Leading buyers']] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={view === key} className={cn("rounded-lg border px-3 py-2 text-xs", view === key ? "border-brand bg-brand/10" : "border-border")} onClick={() => setView(key)}>{label}</button>)}</nav>
        {(view === "summary" || view === "periods") && <SummaryTable rows={view === "summary" ? data.commodities : data.periods} onCommodity={(name) => { const id = data.options.commodities.find((o) => o.name === name)?.id; const next = { ...filters, commodityId: id }; setFilters(next); setDraft(next); setView("batches"); setPage(0); }} />}
        {view === "comparison" && <section className="space-y-2"><p className="text-xs text-subtle">Compared with {data.previousRange.from} to {data.previousRange.to}, using the same filters. Calendar months/years compare to the previous calendar period; custom ranges compare to the preceding equal number of days.</p><div className="kastros-table-wrap overflow-auto"><table className="kastros-table text-xs"><thead><tr>{["Commodity", "Currency", "Current sales", "Previous sales", "Change", "Change %"].map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{data.comparisons.map((c) => <tr key={`${c.commodity}:${c.currency}`}><td>{c.commodity}</td><td>{c.currency}</td><td>{fmt(c.sales)}</td><td>{fmt(c.previousSales)}</td><td>{signed(c.change)}</td><td>{fmt(c.changePct)}</td></tr>)}</tbody></table></div></section>}
        {view === "buyers" && <div className="kastros-table-wrap max-h-96 overflow-auto"><table className="kastros-table text-xs"><thead><tr>{["Buyer", "Currency", "Sales value", "Sold (MT)", "Sales count"].map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{data.buyers.map((b) => <tr key={`${b.counterpartyId}:${b.currency}`}><td>{b.counterparty}</td><td>{b.currency}</td><td>{fmt(b.sales)}{b.missingValues > 0 && " (known values only)"}</td><td>{fmt(b.quantityMt, 3)}</td><td>{b.count}</td></tr>)}</tbody></table></div>}
        {view === "batches" && <section className="space-y-3">
          <div className="flex flex-wrap gap-2"><input aria-label="Search batch sales" placeholder="Batch, trade, buyer…" className="kastros-input" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} /><select aria-label="Batch profit status" className="kastros-input" value={saleStatus} onChange={(e) => { setSaleStatus(e.target.value); setPage(0); }}><option value="all">All sales</option><option value="profit">Profit</option><option value="loss">Loss</option><option value="even">Break-even</option><option value="missing">Cost not traceable</option></select></div>
          <div className="kastros-table-wrap overflow-auto"><table className="kastros-table text-xs"><thead><tr>{["Batch / sale", "Date", "Commodity / buyer", "Warehouse", "Currency", "Sold (MT)", "Buy cost / MT", "Sell value / MT", "Cost of sold quantity", "Sold for", "Profit / loss", "Cost basis"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{sales.slice(safePage * 25, safePage * 25 + 25).map((s) => <tr key={s.id}>
              <td><div className="font-semibold" title={s.batchRefs.length ? undefined : "No batch is linked to this trade; batch purchase cost cannot be traced."}>{s.batchRefs.join(", ") || "No batch linked"}</div><div>{s.reference}</div></td><td className="whitespace-nowrap">{formatPkDate(s.date)}</td><td>{s.commodity}<div className="text-subtle">{s.counterparty}</div></td><td>{s.warehouse || "—"}</td><td>{s.currency}</td><td>{fmt(s.quantityKg == null ? null : s.quantityKg / 1000, 3)}</td>
              <td>{fmt(s.purchaseCost != null && s.quantityKg ? s.purchaseCost / (s.quantityKg / 1000) : null)}</td><td>{fmt(s.amount != null && s.quantityKg ? s.amount / (s.quantityKg / 1000) : null)}</td>
              <td>{fmt(s.purchaseCost)}</td><td>{fmt(s.amount)}</td><td className={cn("font-semibold whitespace-nowrap", tone(s.profit))}>{signed(s.profit)}<div className="font-normal">{s.profit == null ? "Cost not traceable" : s.profit > 0 ? "Profit" : s.profit < 0 ? "Loss" : "Break-even"}</div></td><td className="min-w-48">{s.costReason}{s.purchaseRefs.length > 0 && <details><summary className="cursor-pointer text-accent-secondary">Purchase references</summary>{s.purchaseRefs.map((r) => <div key={r}>{r}</div>)}</details>}</td>
            </tr>)}</tbody></table>{sales.length === 0 && <p className="p-4 text-subtle">No matching sales.</p>}</div>
          <div className="flex items-center gap-3 text-xs"><button type="button" disabled={safePage === 0} className="kastros-btn-secondary" onClick={() => setPage(safePage - 1)}>Previous</button><span>{sales.length} sales · Page {safePage + 1} of {pageCount}</span><button type="button" disabled={safePage + 1 >= pageCount} className="kastros-btn-secondary" onClick={() => setPage(safePage + 1)}>Next</button></div>
        </section>}
        {view === "purchases" && <div className="kastros-table-wrap max-h-[32rem] overflow-auto"><table className="kastros-table text-xs"><thead><tr>{["Purchase reference", "Batch", "Date", "Commodity", "Seller", "Warehouse", "Quantity (MT)", "Purchase value", "Currency"].map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{data.purchases.map((p) => <tr key={p.id}><td>{p.reference}</td><td title={p.batchRefs.length ? undefined : "No batch is linked to this trade."}>{p.batchRefs.join(", ") || "No batch linked"}</td><td>{formatPkDate(p.date)}</td><td>{p.commodity}</td><td>{p.counterparty}</td><td>{p.warehouse || "—"}</td><td>{fmt(p.quantityKg == null ? null : p.quantityKg / 1000, 3)}</td><td>{fmt(p.amount)}</td><td>{p.currency}</td></tr>)}</tbody></table>{data.purchases.length === 0 && <p className="p-4 text-subtle">No purchases in this period and scope.</p>}</div>}
        {data.commodities.length === 0 && <p className="exec-panel text-sm text-subtle">No qualifying transactions for this period. Try another period or the booked-contract basis.</p>}
        <p className="text-xs text-subtle">Exports include all records matching the applied report filters; batch search, profit filter and table pagination only affect this screen.</p>
      </>}
    </div>
  );
}

function SummaryTable({ rows, onCommodity }: { rows: CommercialReport["commodities"]; onCommodity: (name: string) => void }) {
  return <div className="kastros-table-wrap overflow-auto"><table className="kastros-table text-xs"><thead><tr>{["Period", "Commodity", "Currency", "Purchased (MT)", "Purchase value", "Sold (MT)", "Sales value", "Avg sell / MT", "Purchase − sales", "Matched cost", "Matched profit/loss", "Margin %*", "Cost coverage"].map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r) => <tr key={`${r.period}:${r.commodity}:${r.currency}`}>
    <td>{r.period}</td><td><button type="button" className="text-accent-secondary hover:underline text-left" onClick={() => onCommodity(r.commodity)}>{r.commodity}</button>{(r.missingValues > 0 || r.missingQuantities > 0) && <div className="text-warning">Incomplete values/quantities</div>}</td><td>{r.currency}</td><td>{fmt(r.purchaseQtyMt, 3)}</td><td>{fmt(r.purchaseValue)}</td><td>{fmt(r.salesQtyMt, 3)}</td><td>{fmt(r.salesValue)}</td><td>{fmt(r.averageSellingPrice)}</td><td>{signed(r.purchaseMinusSales)}</td><td>{r.costedCount ? fmt(r.purchaseCost) : "—"}</td><td className={tone(r.costedCount ? r.matchedProfit : null)}>{r.costedCount ? signed(r.matchedProfit) : "—"}</td><td>{fmt(r.marginPct)}</td><td>{r.costedCount}/{r.salesCount} sales</td>
  </tr>)}</tbody></table><p className="p-3 text-xs text-subtle">* Margin uses matched sales only. Uncosted sales are excluded, never treated as zero-cost sales.</p></div>;
}
