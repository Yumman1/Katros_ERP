"use client";

import { trpc } from "@/lib/trpc/client";
import { formatCurrency, formatQty } from "@/lib/formatters/numbers";

export default function TraderPositionsPage() {
  const { data: exposure, isLoading } = trpc.trader.myExposure.useQuery();
  const { data: trades } = trpc.trader.myTrades.useQuery({});

  if (isLoading) {
    return <div className="animate-pulse text-zinc-500">Loading your book…</div>;
  }

  const totalMtm = exposure?.reduce((a, e) => a + e.mtm, 0) ?? 0;
  const activeTrades =
    trades?.filter((t) => ["CONFIRMED", "EXECUTED", "PENDING", "LOCKED"].includes(t.tradeStatus)) ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-white">My Book</h1>
        <p className="text-sm text-zinc-500">Your net exposure and open trade legs by commodity.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-kastros-border bg-kastros-card px-4 py-3">
          <div className="text-xs uppercase text-zinc-500">Active legs</div>
          <div className="mt-1 text-2xl font-medium text-white">{activeTrades.length}</div>
        </div>
        <div className="rounded-lg border border-kastros-border bg-kastros-card px-4 py-3">
          <div className="text-xs uppercase text-zinc-500">Commodities</div>
          <div className="mt-1 text-2xl font-medium text-white">{exposure?.length ?? 0}</div>
        </div>
        <div className="rounded-lg border border-kastros-border bg-kastros-card px-4 py-3">
          <div className="text-xs uppercase text-zinc-500">Total open MTM</div>
          <div className={`mt-1 text-2xl font-medium data-grid ${totalMtm >= 0 ? "text-kastros-green" : "text-kastros-red"}`}>
            {formatCurrency(totalMtm)}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-kastros-border bg-kastros-card">
        <div className="border-b border-kastros-border px-3 py-2 text-sm text-zinc-300">Exposure by commodity</div>
        <table className="w-full border-collapse text-sm">
          <thead className="text-left text-xs uppercase text-zinc-500">
            <tr>
              {["Commodity", "Long (MT)", "Short (MT)", "Net (MT)", "Market", "MTM P&L"].map((h) => (
                <th key={h} className="border-b border-kastros-border px-3 py-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {exposure?.map((e) => (
              <tr key={e.code} className="border-b border-kastros-border/60">
                <td className="px-3 py-2 font-medium text-white">
                  {e.code} <span className="text-xs font-normal text-zinc-500">{e.name}</span>
                </td>
                <td className="px-3 py-2 data-grid text-kastros-green">{formatQty(e.long)}</td>
                <td className="px-3 py-2 data-grid text-kastros-red">{formatQty(e.short)}</td>
                <td className="px-3 py-2 data-grid">{formatQty(e.net)}</td>
                <td className="px-3 py-2 data-grid">{formatCurrency(e.marketPrice)}</td>
                <td className={`px-3 py-2 data-grid ${e.mtm >= 0 ? "text-kastros-green" : "text-kastros-red"}`}>
                  {formatCurrency(e.mtm)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
