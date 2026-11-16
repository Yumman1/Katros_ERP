"use client";

import { useState } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";

export type ImportTradeRow = {
  tradeRef: string;
  supplier: string;
  tradeDate?: string;
  quantity?: number;
  shipments: number;
};

export function PkeImportTradeList({ trades, selected, busy, dubai, onOpen }: {
  trades: ImportTradeRow[];
  selected?: string;
  busy: boolean;
  dubai: boolean;
  onOpen: (ref: string) => void;
}) {
  const [counterparty, setCounterparty] = useState("");
  const [reference, setReference] = useState("");
  const [dateMode, setDateMode] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [minimum, setMinimum] = useState("");
  const [maximum, setMaximum] = useState("");
  const invalidDates = dateMode === "range" && from && to && from > to;
  const invalidQuantity = minimum !== "" && maximum !== "" && Number(minimum) > Number(maximum);
  const rows = trades.filter(trade => {
    const date = trade.tradeDate?.slice(0, 10) ?? "";
    return !invalidDates && !invalidQuantity &&
      (!counterparty || trade.supplier === counterparty) &&
      trade.tradeRef.toLowerCase().includes(reference.trim().toLowerCase()) &&
      (dateMode === "all" || ((!from || date >= from) && (dateMode === "day" ? !from || date === from : !to || (!!date && date <= to)))) &&
      (minimum === "" || (trade.quantity !== undefined && trade.quantity >= Number(minimum))) &&
      (maximum === "" || (trade.quantity !== undefined && trade.quantity <= Number(maximum)));
  });
  const input = "kastros-input w-full min-w-0 text-xs";
  function clear() {
    setCounterparty(""); setReference(""); setDateMode("all");
    setFrom(""); setTo(""); setMinimum(""); setMaximum("");
  }
  return <div>
    <section aria-label="Import trade filters" className="my-3 rounded-xl border border-border bg-card p-3 text-xs">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[180px] flex-1 space-y-1">
          <span className="block text-subtle">Trade number</span>
          <input type="search" className={input} placeholder="KAS-2026-…" value={reference} onChange={e => setReference(e.target.value)} />
        </label>
        <label className="w-48 space-y-1"><span className="block text-subtle">Counterparty</span>
          <SearchableSelect searchable aria-label="Counterparty" className="kastros-select w-full text-xs" value={counterparty} onChange={e => setCounterparty(e.target.value)}>
            <option value="">ALL</option>
            {[...new Set(trades.map(t => t.supplier))].sort().map(name => <option key={name} value={name}>{name}</option>)}
          </SearchableSelect>
        </label>
        <label className="w-36 space-y-1"><span className="block text-subtle">Trade date</span>
          <SearchableSelect searchable={false} aria-label="Trade date" className="kastros-select w-full text-xs" value={dateMode} onChange={e => { setDateMode(e.target.value); setFrom(""); setTo(""); }}>
            <option value="all">All dates</option><option value="day">Specific date</option><option value="range">Date range</option>
          </SearchableSelect>
        </label>
        {dateMode !== "all" && <label className="space-y-1"><span className="block text-subtle">{dateMode === "day" ? "On date" : "From date"}</span><input type="date" className={input} value={from} max={dateMode === "range" ? to || undefined : undefined} onChange={e => setFrom(e.target.value)} /></label>}
        {dateMode === "range" && <label className="space-y-1"><span className="block text-subtle">To date</span><input type="date" className={input} value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></label>}
        <fieldset className="w-52"><legend className="mb-1 text-subtle">Quantity (MT)</legend><div className="flex gap-2">
          <input aria-label="Minimum quantity MT" type="number" min="0" step="any" className={input} placeholder="Min" value={minimum} onChange={e => setMinimum(e.target.value)} />
          <input aria-label="Maximum quantity MT" type="number" min="0" step="any" className={input} placeholder="Max" value={maximum} onChange={e => setMaximum(e.target.value)} />
        </div></fieldset>
        <button type="button" className="kastros-btn-secondary text-xs" onClick={clear}>Clear filters</button>
      </div>
      {invalidDates && <p role="alert" className="mt-2 text-destructive">From date must be before or equal to the to date.</p>}
      {invalidQuantity && <p role="alert" className="mt-2 text-destructive">Minimum quantity must not exceed maximum quantity.</p>}
      <p className="mt-2 text-subtle">{rows.length} of {trades.length} trades match.</p>
    </section>
    <div className="max-h-80 overflow-auto">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-background text-xs text-subtle"><tr>
          <th className="px-3 py-2">Trade number</th><th className="px-3 py-2">Counterparty</th><th className="px-3 py-2">Trade date</th><th className="px-3 py-2 text-right">Quantity (MT)</th><th className="px-3 py-2">Shipments</th>
        </tr></thead>
        <tbody>{rows.map(trade => <tr key={trade.tradeRef} className={`border-b border-border/40 ${selected === trade.tradeRef ? "bg-indigo-500/10" : "hover:bg-white/5"}`}>
          <td className="px-3 py-3"><button type="button" aria-pressed={selected === trade.tradeRef} className="font-semibold text-indigo-300 underline-offset-4 hover:underline disabled:opacity-50" disabled={busy || (dubai && !trade.shipments)} onClick={() => onOpen(trade.tradeRef)}>{trade.tradeRef}</button></td>
          <td className="px-3 py-3">{trade.supplier}</td><td className="whitespace-nowrap px-3 py-3">{trade.tradeDate?.slice(0, 10) ?? "—"}</td>
          <td className="px-3 py-3 text-right tabular-nums">{trade.quantity?.toLocaleString("en-PK", { maximumFractionDigits: 6 }) ?? "—"}</td>
          <td className="px-3 py-3 text-subtle">{trade.shipments || (dubai ? "Awaiting Pakistan file" : "Not started")}</td>
        </tr>)}</tbody>
      </table>
      {!rows.length && <p className="p-4 text-sm text-subtle">No trades match these filters.</p>}
    </div>
  </div>;
}
