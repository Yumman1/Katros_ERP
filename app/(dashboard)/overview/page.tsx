"use client";

import { trpc } from "@/lib/trpc/client";
import { formatCurrency } from "@/lib/formatters/numbers";
import Link from "next/link";

export default function DashboardOverviewPage() {
  const { data: kpis, isLoading } = trpc.reports.kpis.useQuery();

  if (isLoading || !kpis) {
    return <div className="animate-pulse text-zinc-500">Loading desk snapshot…</div>;
  }

  const tiles = [
    { label: "Trades YTD", value: kpis.tradesYtd.toLocaleString() },
    { label: "Open trades", value: kpis.openTrades.toLocaleString() },
    { label: "Inventory value", value: formatCurrency(kpis.inventoryValue) },
    { label: "Open MTM P&L", value: formatCurrency(kpis.openMtmPnl) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Trading desk overview</h1>
        <p className="mt-1 text-sm text-zinc-500">Risk, finance, and supply-chain snapshot</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="rounded-lg border border-kastros-border bg-kastros-card p-4"
          >
            <p className="text-xs uppercase tracking-wide text-zinc-500">{t.label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-white">{t.value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/positions" className="rounded-lg border border-kastros-border bg-kastros-card p-4 hover:border-kastros-green/40">
          <p className="font-medium text-white">Positions</p>
          <p className="mt-1 text-sm text-zinc-500">Exposure by commodity and desk</p>
        </Link>
        <Link href="/reports" className="rounded-lg border border-kastros-border bg-kastros-card p-4 hover:border-kastros-green/40">
          <p className="font-medium text-white">Reports</p>
          <p className="mt-1 text-sm text-zinc-500">Blotter, breaks, and KPI exports</p>
        </Link>
      </div>
    </div>
  );
}
