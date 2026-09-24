"use client";
import { useDeskWidgets } from "@/components/trader/desk-widget-editor";
import type { DeskWidgetId } from "@/lib/trader-desk-widgets";
import { useCommodityDesk } from "@/components/trader/commodity-desk-provider";

import { useRecordFilters } from "@/components/ui/record-filters";
import { tradeFilterConfig } from "@/lib/record-filters";

import { trpc } from "@/lib/trpc/client";
import { priceUnitLabel } from "@/lib/price-units";
import { formatCurrency, formatQty } from "@/lib/formatters/numbers";
import Link from "next/link";
import { TradeStatus } from "@prisma/client";
import { OverdueAlertsCard } from "@/components/ledgers/overdue-alerts-card";
import { DeskPage, DeskScroll } from "@/components/layout/desk-page";
import { TraderDeskReports } from "@/components/trader/trader-desk-reports";
import { isActiveTraderTrade } from "@/lib/trade-lifecycle";

const statusStyle: Partial<Record<TradeStatus, string>> = {
  PENDING: "bg-warning/20 text-warning",
  LOCKED: "bg-purple-500/20 text-purple-300",
  EXECUTED: "bg-success/20 text-success",
  SETTLED: "bg-zinc-500/20 text-muted-foreground",
  CANCELLED: "bg-red-500/20 text-red-400",
};

export default function TraderDeskPage() {
  const desk = useCommodityDesk();
  const widgets = useDeskWidgets(desk.active?.id);
  const input = { commodityId: desk.active?.id };
  const options = { enabled: Boolean(desk.active), refetchInterval: 30_000 };
  const { data: summary, isLoading, error: summaryError } = trpc.trader.deskSummary.useQuery(input, options);
  const { data: trades } = trpc.trader.myTrades.useQuery(input, options);
  const { data: actions } = trpc.trader.actionItems.useQuery(input, options);
  const { data: exposure } = trpc.trader.myExposure.useQuery(input, options);

  const listFilters = useRecordFilters("desk-trades", (trades ?? []).filter(isActiveTraderTrade), tradeFilterConfig);

  if (!desk.loading && !desk.active) return <div className="space-y-3"><h1 className="text-2xl font-semibold">Your commodity dashboard</h1><p>{desk.error ?? "No commodities are assigned yet. Request a commodity and ask the CEO to approve it, or ask the CEO to assign an existing commodity."}</p><Link href="/trader/trades/new" className="text-success underline">Request a commodity</Link></div>;
  if (summaryError) return <p role="alert" className="text-destructive">{summaryError.message}</p>;
  if (isLoading || !summary) {
    return <div className="animate-pulse text-subtle">Loading your desk…</div>;
  }

  const openTrades = listFilters.rows.slice(0, 8);

  return (
    <DeskPage>
      <DeskScroll className="space-y-4 pb-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{desk.active?.name} Dashboard</h1>
            <p className="text-sm text-subtle">
              {desk.active?.name} · Your open book and today&apos;s activity
            </p>
          </div>
          <Link
            href="/trader/trades/new"
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-kastros-bg hover:opacity-90"
          >
            Book new trade
          </Link>
        </div>

        {widgets.editor}
        {widgets.empty && <p className="rounded-lg border border-border p-6 text-subtle">Your desk is empty. Use Edit widgets to add widgets back.</p>}
        {widgets.visible("overdue") && <OverdueAlertsCard title="Company-wide overdue payments" />}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          {[
            { id: "totalBought", label: "Total bought", value: `${formatQty(summary.totalBoughtMt)} MT`, detail: "Confirmed purchases, all time" },
            { id: "inventory", label: "Inventory", value: summary.inventoryMt == null ? "—" : `${formatQty(summary.inventoryMt)} MT`, detail: "Commodity stock across warehouses" },
            { id: "totalSold", label: "Total sold", value: `${formatQty(summary.totalSoldMt)} MT`, detail: "Confirmed sales, all time" },
            { id: "openTrades", label: "Open trades", value: summary.openTrades.toString() },
            { id: "deliveries", label: "Deliveries this week", value: summary.deliveriesThisWeek.toString() },
            { id: "bookedToday", label: "Booked today", value: summary.bookedToday.toString() },
            { id: "todayVolume", label: "Today's volume", value: `${formatQty(summary.todayVolumeMt)} MT` },
            { id: "openMtm", label: "My open MTM", value: summary.mtmUnconverted ? "Unavailable" : formatCurrency(summary.myMtm, "USD"), detail: summary.mtmUnconverted ? `${summary.mtmUnconverted} trade(s) missing FX conversion` : "Open locked trades · USD", tone: summary.myMtm >= 0 ? "up" : "down" },
          ].filter(t => widgets.visible(t.id as DeskWidgetId)).map((t) => (
            <div
              key={t.label}
              className="rounded-lg border border-kastros-border bg-kastros-card px-3 py-2.5"
            >
              <div className="text-xs uppercase tracking-wide text-subtle">{t.label}</div>
              <div
                className={`mt-1 data-grid text-lg font-medium ${
                  "tone" in t && t.tone === "up"
                    ? "text-success"
                    : "tone" in t && t.tone === "down"
                      ? "text-kastros-red"
                      : "text-foreground"
                }`}
              >
                {t.value}
              </div>
              {t.detail && <p className="mt-1 text-xs text-subtle">{t.detail}</p>}
            </div>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {widgets.visible("tradeList") && <div className={`${widgets.visible("actions") || widgets.visible("mtmCommodity") || widgets.visible("exposure") ? "lg:col-span-2" : "lg:col-span-3"} rounded-lg border border-kastros-border bg-kastros-card`}>
            <div className="flex items-center justify-between border-b border-kastros-border px-3 py-2">
              <span className="text-sm font-medium text-muted-foreground">My open trades</span>
              <Link href="/trader/trades" className="text-xs text-success hover:underline">
                View all →
              </Link>
            </div>
            {listFilters.controls}
            {listFilters.rows.length > 8 && <p className="px-3 text-xs text-subtle">Showing the first 8 matches. Use My Trades for the full list.</p>}
            <div className="overflow-x-auto text-sm">
              <table className="w-full border-collapse">
                <thead className="text-left text-xs uppercase text-subtle">
                  <tr>
                    {[
                      "Ref",
                      "Date",
                      "Side",
                      "Commodity",
                      "Qty",
                      "Price",
                      "Counterparty",
                      "Delivery",
                      "MTM",
                      "Status",
                    ].map((h) => (
                      <th
                        key={h}
                        className="border-b border-kastros-border px-2 py-2 whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {openTrades.map((t) => (
                    <tr
                      key={t.id}
                      className="border-b border-kastros-border/60 hover:bg-foreground/[0.02]"
                    >
                      <td className="px-2 py-1.5">
                        <Link
                          href={`/trader/trades/${encodeURIComponent(t.tradeRef)}`}
                          className="font-mono text-xs text-success hover:underline"
                        >
                          {t.tradeRef}
                        </Link>
                      </td>
                      <td className="px-2 py-1.5 text-xs text-subtle">
                        {t.tradeDate.toISOString().slice(0, 10)}
                      </td>
                      <td
                        className={`px-2 py-1.5 text-xs font-medium ${t.direction === "BUY" ? "text-success" : "text-kastros-red"}`}
                      >
                        {t.direction}
                      </td>
                      <td className="px-2 py-1.5">{t.commodity.code}</td>
                      <td className="px-2 py-1.5 data-grid">
                        {formatQty(t.quantity)} {t.quantityUnit ?? t.commodity.unit}
                      </td>
                      <td className="px-2 py-1.5 data-grid">
                        {t.price > 0 ? (
                          <>
                            {t.price.toLocaleString()}{" "}
                            <span className="text-subtle">
                              {t.priceCurrency && t.priceWeightUnit
                                ? priceUnitLabel({
                                    currency: t.priceCurrency,
                                    weightUnit: t.priceWeightUnit,
                                  })
                                : `${t.currency}/${t.quantityUnit ?? t.commodity.unit}`}
                            </span>
                          </>
                        ) : (
                          <span className="text-subtle">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-muted-foreground max-w-[100px] truncate">
                        {t.counterparty.name}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-subtle">
                        {t.deliveryStart.toISOString().slice(0, 10)}
                      </td>
                      <td
                        className={`px-2 py-1.5 data-grid ${(t.mtmPnlUsd ?? t.mtmPnl) >= 0 ? "text-success" : "text-kastros-red"}`}
                      >
                        {t.mtmPnlUsd == null ? "Unavailable" : formatCurrency(t.mtmPnlUsd, "USD")}
                      </td>
                      <td className="px-2 py-1.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs ${statusStyle[t.tradeStatus] ?? ""}`}
                        >
                          {t.tradeStatus}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>}

          <div className={widgets.visible("tradeList") ? "space-y-4" : "space-y-4 lg:col-span-3"}>
            {widgets.visible("actions") && <div className="rounded-lg border border-kastros-border bg-kastros-card p-3">
              <h2 className="text-sm font-medium text-muted-foreground">Action required</h2>
              <div className="mt-2 space-y-2">
                {(actions ?? []).length === 0 && (
                  <p className="text-xs text-subtle">No pending actions — you&apos;re clear.</p>
                )}
                {actions?.map((a) => (
                  <Link
                    key={a.id}
                    href={`/trader/trades/${encodeURIComponent(a.tradeRef)}`}
                    className={`block rounded-md border px-3 py-2 text-xs hover:bg-foreground/[0.02] ${
                      a.priority === "high"
                        ? "border-warning/30 bg-warning/5 text-warning"
                        : "border-kastros-border text-muted-foreground"
                    }`}
                  >
                    <div className="font-medium text-muted-foreground">{a.tradeRef}</div>
                    <div className="mt-0.5">{a.message}</div>
                  </Link>
                ))}
              </div>
            </div>}

            {widgets.visible("exposure") && <div className="rounded-lg border border-kastros-border bg-kastros-card p-3">
              <h2 className="text-sm font-medium text-muted-foreground">My exposure by commodity</h2>
              <div className="mt-2 space-y-2">{exposure?.map(e => <div key={e.code} className="flex items-center justify-between gap-2 text-xs"><span>{e.code} · Net {formatQty(e.net)} MT</span><span className="data-grid">{e.mtmUnconverted ? "Unavailable" : formatCurrency(e.mtm, "USD")}</span></div>)}</div>
            </div>}

            {widgets.visible("mtmCommodity") && <div className="rounded-lg border border-kastros-border bg-kastros-card p-3">
              <h2 className="text-sm font-medium text-muted-foreground">MTM by commodity</h2>
              <div className="mt-3 flex items-center justify-between gap-3 text-sm"><span>{desk.active?.name}</span><span className="data-grid">{summary.mtmUnconverted ? "Unavailable" : formatCurrency(summary.myMtm, "USD")}</span></div>
              <p className="mt-2 text-xs text-subtle">{summary.mtmUnconverted ? `${summary.mtmUnconverted} trade(s) need an FX rate before a complete USD MTM is available.` : "Open locked trades for this commodity. Switch desks to view another commodity."}</p>
            </div>}

          </div>
        </div>

        {widgets.visible("reports") && <TraderDeskReports key={desk.active?.id} deskCommodityCode={desk.active?.code} />}
      </DeskScroll>
    </DeskPage>
  );
}
