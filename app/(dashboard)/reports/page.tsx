"use client";

import { trpc } from "@/lib/trpc/client";
import { formatCurrency } from "@/lib/formatters/numbers";

export default function ReportsPage() {
  const blotter = trpc.reports.tradeBlotter.useQuery();
  const breaks = trpc.reports.openBreaks.useQuery();

  return (
    <div className="kastros-desk-page">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Reports hub</h1>
        <p className="text-sm text-subtle">
          Trade blotter and open reconciliation breaks — extend with scheduled exports.
        </p>
      </div>
      <section className="overflow-hidden rounded-lg border border-kastros-border bg-kastros-card">
        <div className="border-b border-kastros-border px-3 py-2 text-sm font-medium text-muted-foreground">
          Trade blotter
        </div>
        <div className="min-h-0 flex-1 overflow-auto text-sm">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-kastros-card text-left text-xs uppercase text-subtle">
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
                  <td className="px-2 py-1 text-muted-foreground">{t.tradeRef}</td>
                  <td className="px-2 py-1">{t.tradeDate.toISOString().slice(0, 10)}</td>
                  <td className="px-2 py-1">{t.commodity.code}</td>
                  <td className="px-2 py-1">{t.direction}</td>
                  <td className="px-2 py-1">{Number(t.quantity).toLocaleString()}</td>
                  <td className="px-2 py-1">{formatCurrency(Number(t.price), t.currency)}</td>
                  <td className="px-2 py-1 text-xs">{t.tradeStatus}</td>
                  <td className="max-w-[140px] truncate px-2 py-1 text-subtle">
                    {t.counterparty.name}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="overflow-hidden rounded-lg border border-kastros-border bg-kastros-card">
        <div className="border-b border-kastros-border px-3 py-2 text-sm font-medium text-muted-foreground">
          Open breaks
        </div>
        <div className="min-h-0 flex-1 overflow-auto text-sm">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-kastros-card text-left text-xs uppercase text-subtle">
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
                  <td className="px-2 py-1 text-muted-foreground">{r.referenceA}</td>
                  <td className="px-2 py-1 text-muted-foreground">{r.referenceB}</td>
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
