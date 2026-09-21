"use client";

import { useState } from "react";
import { DeskPage, DeskScroll } from "@/components/layout/desk-page";
import { CounterpartyProfileEditor } from "@/components/trader/counterparty-profile-editor";
import { trpc } from "@/lib/trpc/client";
import type { MockCounterpartyOption } from "@/server/trader-master-data";

export default function CounterpartiesPage() {
  const query = trpc.trader.counterparties.useQuery();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<MockCounterpartyOption | null>(null);
  const [saved, setSaved] = useState("");
  const needle = search.trim().toLocaleLowerCase();
  const rows = (query.data ?? []).filter((cp) =>
    [cp.name, cp.code, cp.ntn, cp.contactPerson, cp.contactPhone, cp.country]
      .some((value) => value?.toLocaleLowerCase().includes(needle)),
  );

  return (
    <DeskPage>
      <DeskScroll className="space-y-5 pb-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Counterparties</h1>
          <p className="text-sm text-subtle">Manage contact, tax, banking and KYC information across the trading desk.</p>
        </div>
        {saved && <p role="status" className="text-sm text-success">{saved}</p>}
        <input type="search" aria-label="Search counterparties" placeholder="Search name, code, NTN or contact…"
          value={search} onChange={(event) => setSearch(event.target.value)} className="kastros-input w-full sm:max-w-md" />
        {query.isLoading ? <p role="status" className="text-sm text-subtle">Loading counterparties…</p>
          : query.isError ? <div role="alert" className="text-sm text-destructive">
            Could not load counterparties. {query.error.message}
            <button type="button" onClick={() => void query.refetch()} className="ml-2 underline">Retry</button>
          </div> : (
            <div className="overflow-x-auto rounded-xl border border-kastros-border bg-kastros-card">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-kastros-border text-xs text-subtle">
                  <tr>{["Counterparty", "Contact", "NTN", "Country", "Tax status", ""].map((label, i) =>
                    <th key={i} scope="col" className="px-4 py-3">{label || "Actions"}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((cp) => <tr key={cp.id} className="border-b border-kastros-border/50 last:border-0">
                    <td className="px-4 py-3"><p className="font-medium text-foreground">{cp.name}</p><p className="text-xs text-subtle">{cp.code} · {cp.type.replaceAll("_", " ")}</p></td>
                    <td className="px-4 py-3"><p>{cp.contactPerson || "—"}</p><p className="text-xs text-subtle">{cp.contactPhone || "—"}</p></td>
                    <td className="px-4 py-3">{cp.ntn || "—"}</td>
                    <td className="px-4 py-3">{cp.country}</td>
                    <td className="px-4 py-3">{cp.taxFilerStatus === "FILER" ? "Filer" : "Non-filer"}</td>
                    <td className="px-4 py-3 text-right">{cp.type === "INTERNAL" ? <span className="text-xs text-subtle">System record</span>
                      : <button type="button" className="kastros-btn-secondary text-xs" aria-label={`Edit ${cp.name}`}
                        onClick={() => { setSaved(""); setEditing(cp); }}>Edit</button>}</td>
                  </tr>)}
                  {!rows.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-subtle">{query.data?.length ? "No matching counterparties." : "No counterparties registered yet."}</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        <p className="text-xs text-subtle">{rows.length} counterparty record{rows.length === 1 ? "" : "s"}</p>
        {editing && <CounterpartyProfileEditor key={editing.id} counterparty={editing}
          onClose={() => setEditing(null)} onSaved={(cp) => { setSaved(`${cp.name} updated.`); setEditing(null); }} />}
      </DeskScroll>
    </DeskPage>
  );
}
