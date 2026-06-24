"use client";

import { trpc } from "@/lib/trpc/client";
import { formatCurrency } from "@/lib/formatters/numbers";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export default function AnalyticsPage() {
  const kpis = trpc.reports.kpis.useQuery();
  const curve = trpc.mtm.historyTotals.useQuery({ days: 180 });
  const blotter = trpc.reports.tradeBlotter.useQuery();

  const byCmdty = new Map<string, { buy: number; sell: number }>();
  for (const t of blotter.data ?? []) {
    const cur = byCmdty.get(t.commodity.code) ?? { buy: 0, sell: 0 };
    if (t.direction === "BUY") cur.buy += Number(t.quantity);
    else cur.sell += Number(t.quantity);
    byCmdty.set(t.commodity.code, cur);
  }
  const flow = Array.from(byCmdty.entries()).map(([code, v]) => ({ code, ...v }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Analytics</h1>
        <p className="text-sm text-zinc-500">Cross-module KPIs and flow.</p>
      </div>
      {kpis.data && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Trades YTD" value={kpis.data.tradesYtd.toString()} />
          <Tile label="Open trades" value={kpis.data.openTrades.toString()} />
          <Tile label="Inventory value" value={formatCurrency(kpis.data.inventoryValue)} />
          <Tile label="Open MTM" value={formatCurrency(kpis.data.openMtmPnl)} />
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-64 rounded-lg border border-kastros-border bg-kastros-card p-3">
          <div className="text-sm text-zinc-300">MTM trend (6 mo daily)</div>
          <ResponsiveContainer width="100%" height="90%">
            <LineChart data={curve.data ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3142" />
              <XAxis dataKey="date" tickFormatter={(v) => v.slice(2, 7)} stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip
                contentStyle={{ background: "#1a1f2e", border: "1px solid #2a3142" }}
                formatter={(v) => formatCurrency(Number(v ?? 0))}
              />
              <Line type="monotone" dataKey="total" stroke="#00C896" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="h-64 rounded-lg border border-kastros-border bg-kastros-card p-3">
          <div className="text-sm text-zinc-300">Buy vs sell volume (blotter sample)</div>
          <ResponsiveContainer width="100%" height="90%">
            <BarChart data={flow}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3142" />
              <XAxis dataKey="code" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip contentStyle={{ background: "#1a1f2e", border: "1px solid #2a3142" }} />
              <Bar dataKey="buy" stackId="z" fill="#00C896" name="Buy" />
              <Bar dataKey="sell" stackId="z" fill="#FF4D4F" name="Sell" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-kastros-border bg-kastros-card px-3 py-2">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="data-grid text-lg font-semibold text-white">{value}</div>
    </div>
  );
}
