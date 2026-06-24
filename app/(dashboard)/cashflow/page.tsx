"use client";

import { trpc } from "@/lib/trpc/client";
import { formatCurrency } from "@/lib/formatters/numbers";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export default function CashflowPage() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const d = useMemo(() => new Date(month + "-01"), [month]);
  const { data } = trpc.cashflow.list.useQuery({ month: d });
  const upcoming = trpc.cashflow.upcoming.useQuery();

  const weekly = useMemo(() => {
    if (!data?.rows.length) return [];
    const buckets = new Map<string, number>();
    for (const r of data.rows) {
      const wk = r.valueDate.slice(0, 10);
      buckets.set(wk, (buckets.get(wk) ?? 0) + r.amount);
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amt]) => ({ date, amt }));
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Cash flow</h1>
          <p className="text-sm text-zinc-500">Projected vs actual liquidity.</p>
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

      {data && (
        <div className="grid gap-3 sm:grid-cols-4">
          <CashCard label="Receipts" value={data.summary.receipts} />
          <CashCard label="Payments" value={data.summary.payments} />
          <CashCard label="Net" value={data.summary.net} />
          <CashCard label="Running close" value={data.summary.closing} />
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <div className="h-64 rounded-lg border border-kastros-border bg-kastros-card p-3">
          <div className="text-sm text-zinc-300">Daily net (selected month)</div>
          <ResponsiveContainer width="100%" height="90%">
            <BarChart data={weekly}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3142" />
              <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip
                contentStyle={{ background: "#1a1f2e", border: "1px solid #2a3142" }}
                formatter={(v) => formatCurrency(Number(v ?? 0))}
              />
              <Bar dataKey="amt" fill="#00C896" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-lg border border-kastros-border bg-kastros-card p-3 text-sm">
          <div className="font-medium text-zinc-300">Upcoming invoices</div>
          <ul className="mt-2 max-h-56 space-y-2 overflow-auto text-xs text-zinc-400">
            {upcoming.data?.map((inv) => (
              <li key={inv.id} className="flex justify-between gap-2 border-b border-kastros-border/50 pb-1">
                <span className="truncate">{inv.invoiceRef}</span>
                <span>{formatCurrency(Number(inv.amount), inv.currency)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-kastros-border bg-kastros-card">
        <div className="border-b border-kastros-border px-3 py-2 text-sm text-zinc-300">Ledger</div>
        <div className="max-h-[440px] overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-kastros-card text-left text-xs uppercase text-zinc-500">
              <tr>
                {["Value date", "Type", "Description", "Amount", "Run", "Mode"].map((h) => (
                  <th key={h} className="border-b border-kastros-border px-2 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="data-grid">
              {data?.rows.map((r) => (
                <tr key={r.id} className="h-9 border-b border-kastros-border/60">
                  <td className={cn("px-2 py-1", r.isProjected && "italic text-zinc-500")}>
                    {r.valueDate.slice(0, 10)}
                  </td>
                  <td className="px-2 py-1">{r.type}</td>
                  <td className="max-w-[280px] truncate px-2 py-1">{r.description}</td>
                  <td
                    className={cn(
                      "px-2 py-1",
                      r.amount >= 0 ? "text-kastros-green" : "text-kastros-red",
                    )}
                  >
                    {formatCurrency(r.amount, r.currency)}
                  </td>
                  <td className="px-2 py-1">{formatCurrency(r.running, r.currency)}</td>
                  <td className="px-2 py-1 text-xs text-zinc-500">
                    {r.isProjected ? "Projected" : "Actual"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CashCard({ label, value }: { label: string; value: number }) {
  const pos = value >= 0;
  return (
    <div className="rounded-lg border border-kastros-border bg-kastros-card px-3 py-2">
      <div className="text-xs text-zinc-500">{label}</div>
      <div
        className={cn(
          "data-grid text-lg font-semibold",
          pos ? "text-kastros-green" : "text-kastros-red",
        )}
      >
        {formatCurrency(value)}
      </div>
    </div>
  );
}
