"use client";

import { trpc } from "@/lib/trpc/client";
import { formatCurrency } from "@/lib/formatters/numbers";

export default function ReportsPage() {
  const blotter = trpc.reports.tradeBlotter.useQuery();
  const breaks = trpc.reports.openBreaks.useQuery();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Reports hub</h1>
        <p className="text-sm text-zinc-500">
          Trade blotter and open reconciliation breaks — extend with scheduled exports.
        </p>
      </div>
      <section className="overflow-hidden rounded-lg border border-kastros-border bg-kastros-card">
        <div className="border-b border-kastros-border px-3 py-2 text-sm font-medium text-zinc-300">
          Trade blotter
        </div>
        <div className="max-h-[420px] overflow-auto text-sm">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-kastros-card text-left text-xs uppercase text-zinc-500">
              <tr>
                {["Ref", "Date", "Cmdty", "Side", "Qty", "Px", "Status", "Counterparty"].map((h) => (
                  <th key={h} className="border-b border-kastros-border px-2 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="data-grid">
              {blotter.data?.map((t) => (
                <tr key={t.id} className="h-9 border-b border-kastros-border/60">
                  <td className="px-2 py-1 text-zinc-300">{t.tradeRef}</td>
                  <td className="px-2 py-1">{t.tradeDate.toISOString().slice(0, 10)}</td>
                  <td className="px-2 py-1">{t.commodity.code}</td>
                  <td className="px-2 py-1">{t.direction}</td>
                  <td className="px-2 py-1">{Number(t.quantity).toLocaleString()}</td>
                  <td className="px-2 py-1">{formatCurrency(Number(t.price), t.currency)}</td>
                  <td className="px-2 py-1 text-xs">{t.tradeStatus}</td>
                  <td className="max-w-[140px] truncate px-2 py-1 text-zinc-500">
                    {t.counterparty.name}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="overflow-hidden rounded-lg border border-kastros-border bg-kastros-card">
        <div className="border-b border-kastros-border px-3 py-2 text-sm font-medium text-zinc-300">
          Open breaks
        </div>
        <div className="max-h-[280px] overflow-auto text-sm">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-kastros-card text-left text-xs uppercase text-zinc-500">
              <tr>
                {["Date", "Type", "A", "B", "Diff"].map((h) => (
                  <th key={h} className="border-b border-kastros-border px-2 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="data-grid">
              {breaks.data?.map((r) => (
                <tr key={r.id} className="h-9 border-b border-kastros-border/60">
                  <td className="px-2 py-1">{r.reconDate.toISOString().slice(0, 10)}</td>
                  <td className="px-2 py-1 text-xs">{r.reconType}</td>
                  <td className="px-2 py-1 text-zinc-400">{r.referenceA}</td>
                  <td className="px-2 py-1 text-zinc-400">{r.referenceB}</td>
                  <td className="px-2 py-1 text-kastros-red">
                    {formatCurrency(Number(r.difference))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
