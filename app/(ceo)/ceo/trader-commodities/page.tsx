"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { trpc } from "@/lib/trpc/client";

const SOURCES: Record<string, string> = {
  COMMODITY_APPROVAL: "Commodity approved",
  CEO_ASSIGNMENT: "CEO assignment",
  INITIAL_SETUP: "Initial setup",
};

type Edit = { commodityId: string; traderId: string; expectedVersion: number };

export default function CeoTraderCommoditiesPage() {
  const utils = trpc.useUtils();
  const query = trpc.ceo.traderCommodities.useQuery(undefined, { refetchInterval: 30_000 });
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<Edit | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const save = trpc.ceo.assignCommodityTrader.useMutation({
    onSuccess: (result) => {
      const trader = query.data?.traders.find((t) => t.id === result.traderId);
      setNotice(result.traderId
        ? `${result.commodityName} is now assigned to ${trader?.name ?? trader?.email ?? "the selected trader"}.`
        : `${result.commodityName} is now unassigned.`);
      setEdit(null);
      void utils.ceo.traderCommodities.invalidate();
      void utils.ceo.users.invalidate();
    },
    onError: () => { void query.refetch(); },
  });
  const commodities = query.data?.commodities ?? [];
  const traders = query.data?.traders ?? [];
  const unassigned = commodities.filter((c) => !c.traderAssignment?.traderId).length;
  const unavailable = commodities.filter((c) => {
    const trader = c.traderAssignment?.trader;
    return trader && (trader.disabled || trader.role !== "TRADER");
  }).length;
  const needle = search.trim().toLowerCase();
  const rows = commodities.filter((c) =>
    [c.name, c.code, c.traderAssignment?.trader?.name, c.traderAssignment?.trader?.email]
      .some((v) => v?.toLowerCase().includes(needle)),
  );
  const selected = commodities.find((c) => c.id === edit?.commodityId);
  const current = selected?.traderAssignment?.trader;
  const target = traders.find((t) => t.id === edit?.traderId);
  const stale = edit && selected && edit.expectedVersion !== (selected.traderAssignment?.version ?? 0);

  return (
    <div className="kastros-desk-page mx-auto max-w-6xl">
      <PageHeader title="Trader commodities" subtitle="Assign each commodity to its trader. A trader can manage several commodities; only the CEO can change assignments." />
      <div className="kastros-desk-scroll space-y-5 pb-6">
        <div className="flex flex-wrap gap-3 text-sm">
          <span className="rounded-lg border border-kastros-border bg-kastros-card px-4 py-3">{commodities.length} commodities</span>
          <span className={`rounded-lg border border-kastros-border bg-kastros-card px-4 py-3 ${unassigned ? "text-warning" : "text-success"}`}>{unassigned} unassigned</span>
          {unavailable > 0 && <span className="rounded-lg border border-warning/40 px-4 py-3 text-warning">{unavailable} assigned to unavailable traders</span>}
          <Link href="/ceo/users" className="self-center text-brand underline">View users</Link>
        </div>
        <p className="text-sm text-subtle">Approving a trader&apos;s new commodity records its assignment automatically. You can transfer it here at any time.</p>
        {notice && <p role="status" className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm text-success">{notice}</p>}
        {query.isError && <p role="alert" className="text-sm text-danger">Could not load assignments: {query.error.message} <button type="button" className="underline" onClick={() => void query.refetch()}>Retry</button></p>}
        {save.error && <p role="alert" className="text-sm text-danger">{save.error.message}</p>}

        {edit && selected && (
          <section className="rounded-xl border border-brand/50 bg-kastros-card p-5" aria-label="Edit commodity assignment">
            <h2 className="text-base font-semibold">Assign {selected.name} <span className="font-mono text-sm text-subtle">({selected.code})</span></h2>
            <p className="mt-1 text-sm text-subtle">Current trader: {current ? `${current.name ?? current.email} · ${current.email}` : "Unassigned"}</p>
            <label className="mt-4 block text-sm" htmlFor="commodity-trader">New trader</label>
            <SearchableSelect id="commodity-trader" value={edit.traderId} disabled={save.isPending}
              onChange={(e) => setEdit({ ...edit, traderId: e.target.value })}
              className="mt-1 w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm">
              <option value="">Unassigned</option>
              {traders.map((t) => <option key={t.id} value={t.id}>{t.name ?? t.email} — {t.email}</option>)}
              {current && !traders.some((t) => t.id === current.id) && <option value={current.id} disabled>{current.name ?? current.email} — unavailable</option>}
            </SearchableSelect>
            <p className="mt-3 text-sm">{current?.name ?? current?.email ?? "Unassigned"} → {target?.name ?? target?.email ?? "Unassigned"}</p>
            {stale && <p role="alert" className="mt-2 text-sm text-warning">This assignment has changed. Cancel and reopen it to use the latest record.</p>}
            <div className="mt-4 flex gap-3">
              <button type="button" disabled={save.isPending || !!stale || edit.traderId === (selected.traderAssignment?.traderId ?? "") || (!!edit.traderId && !target)}
                onClick={() => save.mutate({ ...edit, traderId: edit.traderId || null })}
                className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-kastros-bg disabled:opacity-50">
                {save.isPending ? "Saving…" : "Save assignment"}
              </button>
              <button type="button" disabled={save.isPending} onClick={() => { setEdit(null); save.reset(); }} className="rounded-md border border-kastros-border px-4 py-2 text-sm">Cancel</button>
            </div>
          </section>
        )}

        <section className="rounded-xl border border-kastros-border bg-kastros-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Commodity assignments</h2>
            <label className="text-xs text-subtle">Search commodities or traders
              <input value={search} onChange={(e) => setSearch(e.target.value)} className="ml-2 rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-foreground" type="search" />
            </label>
          </div>
          <div className="kastros-table-wrap mt-4">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead className="text-left text-xs uppercase text-subtle"><tr>
                <th className="px-3 py-3">Commodity</th><th className="px-3 py-3">Assigned trader</th><th className="px-3 py-3">Last assignment</th><th className="px-3 py-3">Action</th>
              </tr></thead>
              <tbody>{rows.map((c) => {
                const a = c.traderAssignment;
                return <tr key={c.id} className="border-t border-kastros-border">
                  <td className="px-3 py-3"><div className="font-medium">{c.name}</div><div className="font-mono text-xs text-subtle">{c.code}</div></td>
                  <td className="px-3 py-3">{a?.trader ? <><div>{a.trader.name ?? a.trader.email}</div><div className="text-xs text-subtle">{a.trader.email}</div>{(a.trader.disabled || a.trader.role !== "TRADER") && <span className="text-xs text-warning">Unavailable — transfer recommended</span>}</> : <span className="rounded-full bg-warning/15 px-2 py-1 text-xs text-warning">Unassigned</span>}</td>
                  <td className="px-3 py-3 text-xs text-subtle">{a ? <><div>{SOURCES[a.source] ?? a.source}</div><div>{new Date(a.updatedAt).toLocaleString()}</div>{a.changedBy && <div>{a.changedBy.name ?? a.changedBy.email}</div>}</> : "—"}</td>
                  <td className="px-3 py-3"><button type="button" disabled={save.isPending} onClick={() => { setNotice(null); save.reset(); setEdit({ commodityId: c.id, traderId: a?.traderId ?? "", expectedVersion: a?.version ?? 0 }); }} aria-label={`Assign trader for ${c.name}`} className="inline-flex items-center gap-2 rounded-md border border-kastros-border px-3 py-1.5 text-xs hover:bg-kastros-bg disabled:opacity-50"><ArrowRightLeft className="h-3.5 w-3.5" />{a?.traderId ? "Change trader" : "Assign trader"}</button></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          {query.isLoading && <p className="py-6 text-sm text-subtle">Loading assignments…</p>}
          {!query.isLoading && !query.isError && !rows.length && <p className="py-6 text-sm text-subtle">{commodities.length ? "No matching commodities or traders." : "No commodities registered yet. Approved commodities will appear here."}</p>}
        </section>
      </div>
    </div>
  );
}
