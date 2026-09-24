"use client";

import { SearchableSelect } from "@/components/ui/searchable-select";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { emptyFilters, restoreFilters, filterRecords, valueAt, type FilterConfig, type FilterState } from "@/lib/record-filters";

/** Stores selections only; query data and mutations remain owned by the page. */
export function useRecordFilters<T>(key: string, source: readonly T[] | undefined, config: FilterConfig, enabled = true, onClear?: () => void) {
  const path = usePathname();
  const { data: session } = useSession();
  const storageKey = `list-filters:v1:${session?.user?.email ?? "anonymous"}:${path}:${key}`;
  const [saved, setSaved] = useState<{ key: string; state: FilterState }>({ key: "", state: emptyFilters() });
  const state = saved.key === storageKey ? saved.state : emptyFilters();
  useEffect(() => {
    if (!enabled) return;
    let restored = emptyFilters();
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        restored = restoreFilters(JSON.parse(raw));
      }
    } catch { /* Storage may be unavailable; filtering still works. */ }
    setSaved({ key: storageKey, state: restored });
  }, [storageKey, enabled]);
  const setState = (next: FilterState) => {
    setSaved({ key: storageKey, state: next });
    try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Optional persistence. */ }
  };
  const original = source ?? [];
  const rows = enabled ? filterRecords(original, state, config) : [...original];
  const active = state.search !== "" || Object.values(state.selected).some(Boolean) || state.dateMode !== "all" || !!state.deliveryFrom || !!state.deliveryTo || state.sort !== "original";
  return {
    rows, state, active: enabled && active, resetKey: JSON.stringify(state), clear: () => setState(emptyFilters()),
    apply: <R,>(items: readonly R[], override: FilterConfig = config) => enabled ? filterRecords(items, state, override) : [...items],
    controls: enabled ? <RecordFilters source={original} config={config} state={state} onChange={setState} onClear={() => { setState(emptyFilters()); onClear?.(); }} count={rows.length} /> : null,
  };
}

function RecordFilters({ source, config, state, onChange, onClear, count }: {
  source: readonly unknown[]; config: FilterConfig; state: FilterState; onChange: (next: FilterState) => void; onClear: () => void; count: number;
}) {
  const patch = (change: Partial<FilterState>) => onChange({ ...state, ...change });
  const invalid = state.dateMode === "range" && state.from && state.to && state.from > state.to;
  const invalidDelivery = state.deliveryFrom && state.deliveryTo && state.deliveryFrom > state.deliveryTo;
  const inputClass = "kastros-input w-full min-w-0 text-xs";
  return (
    <section aria-label="List filters" className="my-3 max-h-[45vh] shrink-0 overflow-auto rounded-xl border border-border bg-card p-3 text-xs">
      <div className="flex flex-wrap items-end gap-3">
        {config.search !== false && <label className="min-w-[170px] flex-1 space-y-1"><span className="block text-subtle">Search records</span>
          <input type="search" className={inputClass} placeholder="Reference, name, truck…" value={state.search} onChange={(e) => patch({ search: e.target.value })} />
        </label>}
        {(config.fields ?? []).map((f) => {
          const values = [...new Set(source.flatMap((r) => valueAt(r, f.paths) ?? []).filter((v) => v != null && v !== "").map(String))].sort((a, b) => a.localeCompare(b));
          if (state.selected[f.key] && !values.includes(state.selected[f.key])) values.push(state.selected[f.key]);
          return <label key={f.key} className="w-36 space-y-1"><span className="block text-subtle">{f.label}</span>
            <SearchableSelect aria-label={f.label} searchable={/counterparty|warehouse|commodity|trader|location|origin|destination/i.test(f.key)} className="kastros-select w-full text-xs" value={state.selected[f.key] ?? ""} onChange={(e) => patch({ selected: { ...state.selected, [f.key]: e.target.value } })}>
              <option value="">ALL</option>{(f.key === "side" ? ["BUY", "SELL"] : values).map((v) => <option key={v} value={v}>{v === "true" ? "Yes" : v === "false" ? "No" : v.replace(/_/g, " ")}</option>)}
            </SearchableSelect></label>;
        })}
        {config.date && <>
          <label className="w-36 space-y-1"><span className="block text-subtle">{config.date.label}</span>
            <SearchableSelect className="kastros-select w-full text-xs" value={state.dateMode} onChange={(e) => patch({ dateMode: e.target.value as FilterState["dateMode"], from: "", to: "" })}>
              <option value="all">All dates</option><option value="day">Specific date</option><option value="range">Date range</option>
            </SearchableSelect></label>
          {state.dateMode !== "all" && <label className="space-y-1"><span className="block text-subtle">{state.dateMode === "day" ? "On date" : "From date"}</span>
            <input className={inputClass} type="date" value={state.from} max={state.dateMode === "range" ? state.to || undefined : undefined} onChange={(e) => patch({ from: e.target.value })} /></label>}
          {state.dateMode === "range" && <label className="space-y-1"><span className="block text-subtle">To date (inclusive)</span>
            <input className={inputClass} type="date" value={state.to} min={state.from || undefined} onChange={(e) => patch({ to: e.target.value })} /></label>}
        </>}
        {(config.date || config.quantityPaths || config.deliveryDate || config.mtmPaths) && <label className="w-36 space-y-1"><span className="block text-subtle">Sort</span>
          <SearchableSelect searchable={false} className="kastros-select w-full text-xs" value={state.sort} onChange={(e) => patch({ sort: e.target.value })}>
            <option value="original">Default order</option>
            {config.mtmPaths && <option value="mtm-desc">MTM: highest to lowest</option>}
            {config.date && <><option value="date-desc">Newest first</option><option value="date-asc">Oldest first</option></>}
            {config.quantityPaths && <><option value="quantity-desc">Quantity: high to low</option><option value="quantity-asc">Quantity: low to high</option></>}
            {config.deliveryDate && <><option value="delivery-asc">Delivery: earliest</option><option value="delivery-desc">Delivery: latest</option></>}
          </SearchableSelect></label>}
        <button type="button" className="kastros-btn-secondary text-xs" onClick={onClear}>Clear filters</button>
      </div>
      {config.deliveryDate && <details className="mt-2" open={state.deliveryFrom || state.deliveryTo ? true : undefined}>
        <summary className="cursor-pointer text-subtle">{config.deliveryDate.label} range</summary>
        <div className="mt-2 flex flex-wrap gap-3">
          <label>Delivery from<input className={inputClass} type="date" value={state.deliveryFrom} max={state.deliveryTo || undefined} onChange={(e) => patch({ deliveryFrom: e.target.value })} /></label>
          <label>Delivery to (inclusive)<input className={inputClass} type="date" value={state.deliveryTo} min={state.deliveryFrom || undefined} onChange={(e) => patch({ deliveryTo: e.target.value })} /></label>
        </div>
      </details>}
      {(invalid || invalidDelivery) && <p role="alert" className="mt-2 text-destructive">The end date must be on or after the start date.</p>}
      <p role="status" className="mt-2 text-subtle">{count} of {source.length} records match{count === 0 && source.length > 0 ? ". Clear or adjust filters to see more records." : "."}</p>
    </section>
  );
}
