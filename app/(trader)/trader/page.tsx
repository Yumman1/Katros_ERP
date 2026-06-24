"use client";

import { trpc } from "@/lib/trpc/client";
import { formatCurrency, formatQty } from "@/lib/formatters/numbers";
import Link from "next/link";
import { TradeStatus } from "@prisma/client";

const statusStyle: Partial<Record<TradeStatus, string>> = {
  PENDING: "bg-amber-500/20 text-amber-400",
  LOCKED: "bg-purple-500/20 text-purple-300",
  CONFIRMED: "bg-blue-500/20 text-blue-400",
  EXECUTED: "bg-kastros-green/20 text-kastros-green",
  SETTLED: "bg-zinc-500/20 text-zinc-400",
  CANCELLED: "bg-red-500/20 text-red-400",
};

export default function TraderDeskPage() {
  const { data: summary, isLoading } = trpc.trader.deskSummary.useQuery();
  const { data: trades } = trpc.trader.myTrades.useQuery({});
  const { data: actions } = trpc.trader.actionItems.useQuery();
  const { data: exposure } = trpc.trader.myExposure.useQuery();

  if (isLoading || !summary) {
    return <div className="animate-pulse text-zinc-500">Loading your desk…</div>;
  }

  const openTrades = trades?.slice(0, 8) ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">My Desk</h1>
          <p className="text-sm text-zinc-500">
            {summary.desk.replace("_", " ")} · Your open book and today&apos;s activity
          </p>
        </div>
        <Link
          href="/trader/trades/new"
          className="rounded-md bg-kastros-green px-4 py-2 text-sm font-semibold text-kastros-bg hover:opacity-90"
        >
          Book new trade
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        {[
          { label: "Open trades", value: summary.openTrades.toString() },
          { label: "Pending confirmation", value: summary.pendingConfirmation.toString(), warn: summary.pendingConfirmation > 0 },
          { label: "Deliveries this week", value: summary.deliveriesThisWeek.toString() },
          { label: "Booked today", value: summary.bookedToday.toString() },
          { label: "Today's volume", value: `${formatQty(summary.todayVolumeMt)} MT` },
          {
            label: "My open MTM",
            value: formatCurrency(summary.myMtm),
            tone: summary.myMtm >= 0 ? "up" : "down",
          },
        ].map((t) => (
          <div key={t.label} className="rounded-lg border border-kastros-border bg-kastros-card px-3 py-2.5">
            <div className="text-xs uppercase tracking-wide text-zinc-500">{t.label}</div>
            <div
              className={`mt-1 data-grid text-lg font-medium ${
                "tone" in t && t.tone === "up"
                  ? "text-kastros-green"
                  : "tone" in t && t.tone === "down"
                    ? "text-kastros-red"
                    : "warn" in t && t.warn
                      ? "text-amber-400"
                      : "text-white"
              }`}
            >
              {t.value}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 overflow-hidden rounded-lg border border-kastros-border bg-kastros-card">
          <div className="flex items-center justify-between border-b border-kastros-border px-3 py-2">
            <span className="text-sm font-medium text-zinc-300">My open trades</span>
            <Link href="/trader/trades" className="text-xs text-kastros-green hover:underline">
              View all →
            </Link>
          </div>
          <div className="max-h-80 overflow-auto text-sm">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-kastros-card text-left text-xs uppercase text-zinc-500">
                <tr>
                  {["Ref", "Date", "Side", "Commodity", "Qty", "Price", "Counterparty", "Delivery", "MTM", "Status"].map(
                    (h) => (
                      <th key={h} className="border-b border-kastros-border px-2 py-2 whitespace-nowrap">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {openTrades.map((t) => (
                  <tr key={t.id} className="border-b border-kastros-border/60 hover:bg-white/[0.02]">
                    <td className="px-2 py-1.5">
                      <Link href={`/trader/trades/${encodeURIComponent(t.tradeRef)}`} className="font-mono text-xs text-kastros-green hover:underline">
                        {t.tradeRef}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5 text-xs text-zinc-500">{t.tradeDate.toISOString().slice(0, 10)}</td>
                    <td className={`px-2 py-1.5 text-xs font-medium ${t.direction === "BUY" ? "text-kastros-green" : "text-kastros-red"}`}>
                      {t.direction}
                    </td>
                    <td className="px-2 py-1.5">{t.commodity.code}</td>
                    <td className="px-2 py-1.5 data-grid">
                      {formatQty(t.quantity)} {t.quantityUnit ?? t.commodity.unit}
                    </td>
                    <td className="px-2 py-1.5 data-grid">
                      {formatCurrency(t.price, t.currency)}
                      <span className="text-zinc-600"> /{t.quantityUnit ?? t.commodity.unit}</span>
                    </td>
                    <td className="px-2 py-1.5 text-xs text-zinc-400 max-w-[100px] truncate">{t.counterparty.name}</td>
                    <td className="px-2 py-1.5 text-xs text-zinc-500">{t.deliveryStart.toISOString().slice(0, 10)}</td>
                    <td className={`px-2 py-1.5 data-grid ${t.mtmPnl >= 0 ? "text-kastros-green" : "text-kastros-red"}`}>
                      {formatCurrency(t.mtmPnl, t.currency)}
                    </td>
                    <td className="px-2 py-1.5">
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

        <div className="space-y-4">
          <div className="rounded-lg border border-kastros-border bg-kastros-card p-3">
            <h2 className="text-sm font-medium text-zinc-300">Action required</h2>
            <div className="mt-2 space-y-2">
              {(actions ?? []).length === 0 && (
                <p className="text-xs text-zinc-500">No pending actions — you&apos;re clear.</p>
              )}
              {actions?.map((a) => (
                <Link
                  key={a.id}
                  href={`/trader/trades/${encodeURIComponent(a.tradeRef)}`}
                  className={`block rounded-md border px-3 py-2 text-xs hover:bg-white/[0.02] ${
                    a.priority === "high"
                      ? "border-amber-500/30 bg-amber-500/5 text-amber-200"
                      : "border-kastros-border text-zinc-400"
                  }`}
                >
                  <div className="font-medium text-zinc-300">{a.tradeRef}</div>
                  <div className="mt-0.5">{a.message}</div>
                </Link>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-kastros-border bg-kastros-card p-3">
            <h2 className="text-sm font-medium text-zinc-300">My exposure by commodity</h2>
            <div className="mt-2 space-y-2">
              {exposure?.map((e) => (
                <div key={e.code} className="flex items-center justify-between text-xs">
                  <div>
                    <span className="font-medium text-white">{e.code}</span>
                    <span className="ml-2 text-zinc-500">Net {formatQty(e.net)} MT</span>
                  </div>
                  <span className={`data-grid ${e.mtm >= 0 ? "text-kastros-green" : "text-kastros-red"}`}>
                    {formatCurrency(e.mtm)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
