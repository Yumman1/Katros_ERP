"use client";

import { trpc } from "@/lib/trpc/client";
import { formatCurrency, formatQty } from "@/lib/formatters/numbers";
import Link from "next/link";
import { TradeStatus } from "@prisma/client";
import { endOfMonth, startOfMonth } from "date-fns";
import { useState } from "react";

const FILTERS: (TradeStatus | "ALL")[] = ["ALL", "PENDING", "LOCKED", "CONFIRMED", "EXECUTED", "SETTLED"];

const statusStyle: Partial<Record<TradeStatus, string>> = {
  PENDING: "bg-amber-500/20 text-amber-400",
  LOCKED: "bg-purple-500/20 text-purple-300",
  CONFIRMED: "bg-blue-500/20 text-blue-400",
  EXECUTED: "bg-kastros-green/20 text-kastros-green",
  SETTLED: "bg-zinc-500/20 text-zinc-400",
};

export default function MyTradesPage() {
  const [filter, setFilter] = useState<TradeStatus | "ALL">("ALL");
  const exportCsv = trpc.trader.exportLockedTrades.useMutation({
    onSuccess: (res) => {
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
    },
  });
  const { data: trades, isLoading } = trpc.trader.myTrades.useQuery({
    status: filter === "ALL" ? undefined : filter,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">My Trades</h1>
          <p className="text-sm text-zinc-500">All trades you have booked on the desk.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() =>
              exportCsv.mutate({
                from: startOfMonth(new Date()),
                to: endOfMonth(new Date()),
              })
            }
            className="rounded-md border border-kastros-border px-4 py-2 text-sm text-zinc-300 hover:bg-white/5"
          >
            Export locked (month)
          </button>
          <Link
            href="/trader/trades/new"
            className="rounded-md bg-kastros-green px-4 py-2 text-sm font-semibold text-kastros-bg"
          >
            + Book Trade
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-md border px-3 py-1 text-xs ${
              filter === f
                ? "border-kastros-green bg-kastros-green/10 text-kastros-green"
                : "border-kastros-border text-zinc-400 hover:bg-white/5"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-zinc-500">Loading trades…</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-kastros-border bg-kastros-card">
          <div className="max-h-[560px] overflow-auto text-sm">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-kastros-card text-left text-xs uppercase text-zinc-500">
                <tr>
                  {[
                    "Trade ref",
                    "Date",
                    "Side",
                    "Commodity",
                    "Qty (MT)",
                    "Price",
                    "Notional",
                    "Counterparty",
                    "Origin → Dest",
                    "Delivery",
                    "Payment",
                    "MTM",
                    "Status",
                  ].map((h) => (
                    <th key={h} className="border-b border-kastros-border px-2 py-2 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trades?.map((t) => (
                  <tr key={t.id} className="border-b border-kastros-border/60 hover:bg-white/[0.02]">
                    <td className="px-2 py-2">
                      <Link
                        href={`/trader/trades/${encodeURIComponent(t.tradeRef)}`}
                        className="font-mono text-xs text-kastros-green hover:underline"
                      >
                        {t.tradeRef}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-xs text-zinc-500">{t.tradeDate.toISOString().slice(0, 10)}</td>
                    <td className={`px-2 py-2 text-xs font-medium ${t.direction === "BUY" ? "text-kastros-green" : "text-kastros-red"}`}>
                      {t.direction}
                    </td>
                    <td className="px-2 py-2">{t.commodity.code}</td>
                    <td className="px-2 py-2 data-grid">
                      {formatQty(t.quantity)} {t.quantityUnit ?? t.commodity.unit}
                    </td>
                    <td className="px-2 py-2 data-grid">
                      {formatCurrency(t.price, t.currency)}
                      <span className="text-zinc-600"> /{t.quantityUnit ?? t.commodity.unit}</span>
                    </td>
                    <td className="px-2 py-2 data-grid">{formatCurrency(t.quantity * t.price, t.currency)}</td>
                    <td className="px-2 py-2 text-xs text-zinc-400">{t.counterparty.name}</td>
                    <td className="px-2 py-2 text-xs text-zinc-500 max-w-[140px]">
                      {t.originName.split(",")[0]} → {t.destName.split(",")[0]}
                    </td>
                    <td className="px-2 py-2 text-xs text-zinc-500">
                      {t.deliveryStart.toISOString().slice(0, 10)}
                    </td>
                    <td className="px-2 py-2 text-xs text-zinc-500">{t.paymentTerms}</td>
                    <td className={`px-2 py-2 data-grid ${t.mtmPnl >= 0 ? "text-kastros-green" : "text-kastros-red"}`}>
                      {formatCurrency(t.mtmPnl, t.currency)}
                    </td>
                    <td className="px-2 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${statusStyle[t.tradeStatus] ?? ""}`}>
                        {t.tradeStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
