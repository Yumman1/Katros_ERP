"use client";

import { SearchableSelect } from "@/components/ui/searchable-select";

import Link from "next/link";
import { useMemo, useState } from "react";
import { TradeDirection, TradeStatus } from "@prisma/client";
import { CommodityFilterBar } from "@/components/execution/commodity-filter-bar";
import { collectCommodityOptions } from "@/lib/execution-commodity-filter";
import { formatCurrency, formatQty } from "@/lib/formatters/numbers";
import { DESK_REFETCH_MS } from "@/lib/invalidate-caches";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const statusStyle: Partial<Record<TradeStatus, string>> = {
  PENDING: "bg-warning/20 text-warning",
  LOCKED: "bg-purple-500/20 text-purple-300",
  CONFIRMED: "bg-purple-500/20 text-purple-300",
  EXECUTED: "bg-success/20 text-success",
  SETTLED: "bg-zinc-500/20 text-muted-foreground",
  CANCELLED: "bg-red-500/20 text-red-400",
};

function fmtPkr(n: number | null | undefined) {
  if (n == null) return "—";
  return `${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 2 }).format(n)} PKR`;
}

function fmtPkrPerMaund(n: number | null | undefined) {
  if (n == null) return "—";
  return `${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 2 }).format(n)} PKR/maund`;
}

type DirectionFilter = "ALL" | TradeDirection;

export function TraderDeskReports({ deskCommodityCode }: { deskCommodityCode?: string } = {}) {
  const [counterpartyId, setCounterpartyId] = useState<string>("ALL");
  const [commodityCode, setCommodityCode] = useState("ALL");
  const [direction, setDirection] = useState<DirectionFilter>("ALL");

  const queryInput = useMemo(
    () => ({
      counterpartyId: counterpartyId === "ALL" ? undefined : counterpartyId,
      commodityCode: deskCommodityCode ?? (commodityCode === "ALL" ? undefined : commodityCode),
      direction: direction === "ALL" ? undefined : direction,
    }),
    [counterpartyId, commodityCode, direction, deskCommodityCode],
  );

  const { data, isLoading } = trpc.trader.counterpartyReport.useQuery(queryInput, {
    refetchInterval: DESK_REFETCH_MS,
  });

  const commodityOptions = useMemo(() => {
    const fromTrades = (data?.trades ?? []).map((t) => ({
      commodityCode: t.commodityCode,
      commodityName: t.commodityName,
    }));
    return collectCommodityOptions(fromTrades);
  }, [data?.trades]);

  const summary = data?.summary;
  const showDrillDown = counterpartyId !== "ALL";

  return (
    <section className="rounded-lg border border-kastros-border bg-kastros-card">
      <div className="border-b border-kastros-border px-4 py-3">
        <h2 className="text-sm font-medium text-muted-foreground">Counterparty reports</h2>
        <p className="mt-0.5 text-xs text-subtle">
          Open quantity, weighted average cost, MTM, and ledger outstanding — live from your book,
          contracts, receipts, and ledgers.
        </p>
      </div>

      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-subtle">
              Counterparty
            </span>
            <SearchableSelect
              value={counterpartyId}
              onChange={(e) => setCounterpartyId(e.target.value)}
              className="min-w-[200px] rounded-md border border-kastros-border bg-kastros-bg px-2 py-1.5 text-sm text-foreground"
            >
              <option value="ALL">All counterparties</option>
              {(data?.counterparties ?? []).map((cp) => (
                <option key={cp.id} value={cp.id}>
                  {cp.name} ({cp.code})
                </option>
              ))}
            </SearchableSelect>
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-subtle">
              Side
            </span>
            <div className="flex gap-1">
              {(["ALL", "BUY", "SELL"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDirection(d)}
                  className={cn(
                    "rounded-md border px-2.5 py-1.5 text-xs font-medium",
                    direction === d
                      ? "border-brand bg-brand/10 text-foreground"
                      : "border-kastros-border text-muted-foreground hover:bg-foreground/[0.03]",
                  )}
                >
                  {d === "ALL" ? "All" : d}
                </button>
              ))}
            </div>
          </div>
        </div>

        {commodityOptions.length > 0 && !deskCommodityCode && (
          <CommodityFilterBar
            commodities={commodityOptions}
            value={commodityCode}
            onChange={setCommodityCode}
            compact
          />
        )}

        {isLoading && !data && (
          <p className="text-sm text-subtle animate-pulse">Loading reports…</p>
        )}

        {summary && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            {[
              { label: "Counterparties", value: summary.counterpartyCount.toString() },
              { label: "Trades", value: summary.tradeCount.toString() },
              { label: "Open buy (MT)", value: formatQty(summary.openBuyQtyMt) },
              { label: "Open sell (MT)", value: formatQty(summary.openSellQtyMt) },
              { label: "Fulfilled (MT)", value: formatQty(summary.fulfilledQtyMt) },
              {
                label: "MTM (USD)",
                value: formatCurrency(summary.mtmUsd, "USD"),
                tone: summary.mtmUsd >= 0 ? "up" : "down",
              },
              {
                label: "Buy / Sell owed",
                value: `${fmtPkr(summary.buyOutstandingPkr)} / ${fmtPkr(summary.sellOutstandingPkr)}`,
              },
            ].map((k) => (
              <div
                key={k.label}
                className="rounded-md border border-kastros-border/80 bg-kastros-bg/40 px-2.5 py-2"
              >
                <div className="text-[10px] uppercase tracking-wide text-subtle">{k.label}</div>
                <div
                  className={cn(
                    "mt-0.5 text-sm font-medium data-grid",
                    "tone" in k && k.tone === "up"
                      ? "text-success"
                      : "tone" in k && k.tone === "down"
                        ? "text-kastros-red"
                        : "text-foreground",
                  )}
                >
                  {k.value}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse text-sm">
            <thead className="text-left text-[10px] font-semibold uppercase tracking-wider text-subtle">
              <tr>
                {[
                  "Counterparty",
                  "Trades",
                  "Open buy",
                  "Open sell",
                  "Fulfilled",
                  "WAC",
                  "Open paper rate",
                  "MTM (USD)",
                  "Buy owed",
                  "Sell owed",
                ].map((h) => (
                  <th key={h} className="border-b border-kastros-border px-2 py-2 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).length === 0 && !isLoading && (
                <tr>
                  <td colSpan={10} className="px-2 py-6 text-center text-xs text-subtle">
                    No counterparty data for the selected filters.
                  </td>
                </tr>
              )}
              {(data?.rows ?? []).map((r) => (
                <tr
                  key={r.counterpartyId}
                  className="border-b border-kastros-border/60 hover:bg-foreground/[0.02]"
                >
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => setCounterpartyId(r.counterpartyId)}
                      className="text-left text-xs font-medium text-success hover:underline"
                    >
                      {r.counterpartyName}
                    </button>
                    <div className="text-[10px] text-subtle">{r.counterpartyCode}</div>
                  </td>
                  <td className="px-2 py-2 data-grid">{r.tradeCount}</td>
                  <td className="px-2 py-2 data-grid">{formatQty(r.openBuyQtyMt)}</td>
                  <td className="px-2 py-2 data-grid">{formatQty(r.openSellQtyMt)}</td>
                  <td className="px-2 py-2 data-grid">{formatQty(r.fulfilledQtyMt)}</td>
                  <td className="px-2 py-2 data-grid text-xs">
                    {fmtPkrPerMaund(r.weightedAvgCostPkrPerMaund)}
                  </td>
                  <td className="px-2 py-2 data-grid text-xs">
                    {r.openPaperAvgRatePkrPerMt != null
                      ? `${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(r.openPaperAvgRatePkrPerMt)} PKR/MT`
                      : "—"}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-2 data-grid",
                      r.mtmUsd >= 0 ? "text-success" : "text-kastros-red",
                    )}
                  >
                    {formatCurrency(r.mtmUsd, "USD")}
                    {r.mtmUnconverted > 0 && (
                      <span className="ml-1 text-[10px] text-subtle">({r.mtmUnconverted} n/c)</span>
                    )}
                  </td>
                  <td className="px-2 py-2 data-grid text-xs">{fmtPkr(r.buyOutstandingPkr)}</td>
                  <td className="px-2 py-2 data-grid text-xs">{fmtPkr(r.sellOutstandingPkr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {showDrillDown && (data?.trades ?? []).length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-subtle">
              Trade detail
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] border-collapse text-sm">
                <thead className="text-left text-[10px] font-semibold uppercase tracking-wider text-subtle">
                  <tr>
                    {[
                      "Ref",
                      "Date",
                      "Side",
                      "Commodity",
                      "Qty",
                      "Price",
                      "Open",
                      "Fulfilled",
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
                  {(data?.trades ?? []).map((t) => (
                    <tr key={t.tradeRef} className="border-b border-kastros-border/60 hover:bg-foreground/[0.02]">
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
                        className={cn(
                          "px-2 py-1.5 text-xs font-medium",
                          t.direction === "BUY" ? "text-success" : "text-kastros-red",
                        )}
                      >
                        {t.direction}
                      </td>
                      <td className="px-2 py-1.5">{t.commodityCode}</td>
                      <td className="px-2 py-1.5 data-grid">
                        {formatQty(t.quantity)} {t.quantityUnit}
                      </td>
                      <td className="px-2 py-1.5 data-grid text-xs">
                        {t.price > 0 ? `${t.price.toLocaleString()} ${t.currency}` : "—"}
                      </td>
                      <td className="px-2 py-1.5 data-grid">{formatQty(t.openQtyMt)}</td>
                      <td className="px-2 py-1.5 data-grid">{formatQty(t.fulfilledQtyMt)}</td>
                      <td
                        className={cn(
                          "px-2 py-1.5 data-grid",
                          (t.mtmPnlUsd ?? t.mtmPnl) >= 0 ? "text-success" : "text-kastros-red",
                        )}
                      >
                        {t.mtmPnlUsd != null
                          ? formatCurrency(t.mtmPnlUsd, "USD")
                          : formatCurrency(t.mtmPnl, t.currency)}
                      </td>
                      <td className="px-2 py-1.5">
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-xs",
                            statusStyle[t.tradeStatus] ?? "",
                          )}
                        >
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
    </section>
  );
}
