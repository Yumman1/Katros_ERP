"use client";

import { trpc } from "@/lib/trpc/client";
import { formatCurrency } from "@/lib/formatters/numbers";
import { endOfMonth, startOfMonth } from "date-fns";
import { useMemo, useState } from "react";

export default function PnlPage() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const range = useMemo(() => {
    const d = new Date(month + "-01");
    return { from: startOfMonth(d), to: endOfMonth(d) };
  }, [month]);

  const q = trpc.pnl.attribution.useQuery(range);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">P&amp;L explained</h1>
          <p className="text-sm text-zinc-500">Attribution by effect — price, volume, FX.</p>
        </div>
        <label className="text-xs text-zinc-400">
          Month
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="ml-2 rounded border border-kastros-border bg-kastros-bg px-2 py-1 text-sm text-white"
          />
        </label>
      </div>

      {q.data && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Banner label="Total" value={q.data.totalPnl} />
            <Banner label="Price effect" value={q.data.priceEffect} />
            <Banner label="Volume effect" value={q.data.volumeEffect} />
            <Banner label="FX effect" value={q.data.fxEffect} />
          </div>
          <div className="overflow-hidden rounded-lg border border-kastros-border bg-kastros-card">
            <div className="border-b border-kastros-border px-3 py-2 text-sm text-zinc-300">
              Attribution rows (sample)
            </div>
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-kastros-card text-left text-xs uppercase text-zinc-500">
                  <tr>
                    {["Trade", "Commodity", "Dir", "Source", "Amount", "Ccy"].map((h) => (
                      <th key={h} className="border-b border-kastros-border px-2 py-2">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="data-grid">
                  {q.data.rows.slice(0, 200).map((r, i) => (
                    <tr key={`${r.tradeRef}-${i}`} className="h-9 border-b border-kastros-border/60">
                      <td className="px-2 py-1 text-zinc-300">{r.tradeRef}</td>
                      <td className="px-2 py-1">{r.commodity}</td>
                      <td className="px-2 py-1">{r.direction}</td>
                      <td className="px-2 py-1 text-zinc-500">{r.source}</td>
                      <td className="px-2 py-1">{formatCurrency(r.amount, r.currency)}</td>
                      <td className="px-2 py-1">{r.currency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Banner({ label, value }: { label: string; value: number }) {
  const up = value >= 0;
  return (
    <div className="rounded-lg border border-kastros-border bg-kastros-card px-3 py-2">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`data-grid text-lg font-semibold ${up ? "text-kastros-green" : "text-kastros-red"}`}>
        {formatCurrency(value)}
      </div>
    </div>
  );
}
