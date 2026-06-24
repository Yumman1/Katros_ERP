"use client";

import { trpc } from "@/lib/trpc/client";
import { formatCurrency, formatQty } from "@/lib/formatters/numbers";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export default function MtmPage() {
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const date = useMemo(() => new Date(asOf), [asOf]);
  const book = trpc.mtm.getBook.useQuery({ date });
  const curve = trpc.mtm.historyTotals.useQuery({ days: 30 });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Mark to market</h1>
          <p className="text-sm text-zinc-500">Open trades vs latest commodity marks.</p>
        </div>
        <label className="text-xs text-zinc-400">
          Value date
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className="ml-2 rounded border border-kastros-border bg-kastros-bg px-2 py-1 text-sm text-white"
          />
        </label>
      </div>

      {book.data && (
        <div className="flex flex-wrap gap-3">
          <div className="rounded-lg border border-kastros-border bg-kastros-card px-4 py-2">
            <div className="text-xs text-zinc-500">Total unrealized</div>
            <div
              className={cn(
                "data-grid text-xl font-semibold",
                book.data.totalUnrealizedPnl >= 0 ? "text-kastros-green" : "text-kastros-red",
              )}
            >
              {formatCurrency(book.data.totalUnrealizedPnl)}
            </div>
          </div>
          <div className="rounded-lg border border-kastros-border bg-kastros-card px-4 py-2">
            <div className="text-xs text-zinc-500">Open legs</div>
            <div className="data-grid text-xl text-white">{book.data.openCount}</div>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-64 rounded-lg border border-kastros-border bg-kastros-card p-3">
          <div className="mb-2 text-sm text-zinc-300">30-day MTM curve</div>
          <ResponsiveContainer width="100%" height="90%">
            <LineChart data={curve.data ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3142" />
              <XAxis dataKey="date" tickFormatter={(v) => v.slice(5, 10)} stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip
                contentStyle={{ background: "#1a1f2e", border: "1px solid #2a3142" }}
                formatter={(v) => formatCurrency(Number(v ?? 0))}
              />
              <Line type="monotone" dataKey="total" stroke="#00C896" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-lg border border-kastros-border bg-kastros-card p-4 text-sm text-zinc-500">
          Waterfall attribution by commodity — full drill-down in next iteration; use P&amp;L Explained
          for factor view.
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-kastros-border bg-kastros-card">
        <div className="border-b border-kastros-border px-3 py-2 text-sm font-medium text-zinc-300">
          MTM book
        </div>
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead className="sticky top-0 bg-kastros-card text-left text-xs uppercase text-zinc-500">
              <tr>
                {["Trade", "Cmdty", "Qty", "Dir", "Book", "Mkt", "MTM", "Ccy", "Counterparty"].map(
                  (h) => (
                    <th key={h} className="border-b border-kastros-border px-2 py-2">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="data-grid">
              {book.data?.rows.map((r) => (
                <tr
                  key={r.tradeRef}
                  className={cn(
                    "h-9 border-b border-kastros-border/80",
                    r.mtmPnl >= 0 ? "bg-kastros-green/5" : "bg-kastros-red/5",
                  )}
                >
                  <td className="px-2 py-1 text-zinc-300">{r.tradeRef}</td>
                  <td className="px-2 py-1">{r.commodity}</td>
                  <td className="px-2 py-1">{formatQty(r.qty)}</td>
                  <td className="px-2 py-1">{r.direction}</td>
                  <td className="px-2 py-1">{formatCurrency(r.bookPrice, r.currency)}</td>
                  <td className="px-2 py-1">{formatCurrency(r.marketPrice, r.currency)}</td>
                  <td
                    className={cn(
                      "px-2 py-1",
                      r.mtmPnl >= 0 ? "text-kastros-green" : "text-kastros-red",
                    )}
                  >
                    {formatCurrency(r.mtmPnl, r.currency)}
                  </td>
                  <td className="px-2 py-1">{r.currency}</td>
                  <td className="max-w-[160px] truncate px-2 py-1 text-zinc-500">{r.counterparty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
