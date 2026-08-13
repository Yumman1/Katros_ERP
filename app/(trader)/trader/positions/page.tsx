"use client";

import { CommodityFilterBar } from "@/components/execution/commodity-filter-bar";
import { NetPositionPanel } from "@/components/position/net-position-panel";
import { collectCommodityOptions } from "@/lib/execution-commodity-filter";
import { trpc } from "@/lib/trpc/client";
import { formatCurrency, formatQty } from "@/lib/formatters/numbers";
import { DeskPage, DeskScroll } from "@/components/layout/desk-page";
import { useMemo, useState } from "react";

export default function TraderPositionsPage() {
  const [commodityFilter, setCommodityFilter] = useState("ALL");
  const { data: exposure, isLoading: loadingExposure } = trpc.trader.myExposure.useQuery();
  const { data: ledger, isLoading: loadingLedger } = trpc.trader.positionLedger.useQuery(undefined, {
    refetchInterval: 20000,
  });
  const { data: trades } = trpc.trader.myTrades.useQuery({});
  const { data: seasonCols } = trpc.trader.seasonNetPositions.useQuery();

  const commodityOptions = useMemo(() => {
    const fromExposure = (exposure ?? []).map((e) => ({ commodityCode: e.code, commodityName: e.name }));
    const fromLedger = (ledger ?? []).map((r) => ({
      commodityCode: r.commodityCode,
      commodityName: r.commodityName,
    }));
    const fromSeason = (seasonCols ?? []).map((c) => ({
      commodityCode: c.commodityCode,
      commodityName: c.commodityName,
    }));
    return collectCommodityOptions([...fromExposure, ...fromLedger, ...fromSeason]);
  }, [exposure, ledger, seasonCols]);

  const filteredExposure = useMemo(
    () =>
      commodityFilter === "ALL"
        ? (exposure ?? [])
        : (exposure ?? []).filter((e) => e.code === commodityFilter),
    [exposure, commodityFilter],
  );

  const filteredLedger = useMemo(
    () =>
      commodityFilter === "ALL"
        ? (ledger ?? [])
        : (ledger ?? []).filter((r) => r.commodityCode === commodityFilter),
    [ledger, commodityFilter],
  );

  if (loadingExposure && loadingLedger) {
    return <div className="animate-pulse text-muted-foreground">Loading your positions…</div>;
  }

  const totalMtm = filteredExposure.reduce((a, e) => a + e.mtm, 0);
  const activeTrades =
    trades?.filter((t) => ["CONFIRMED", "EXECUTED", "PENDING", "LOCKED"].includes(t.tradeStatus)) ?? [];

  return (
    <DeskPage>
      <DeskScroll className="space-y-5 pb-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Positions</h1>
        <p className="text-sm text-muted-foreground">
          Net position by commodity and crop season, with mark-to-market exposure on your book.
        </p>
      </div>

      {commodityOptions.length > 0 && (
        <CommodityFilterBar commodities={commodityOptions} value={commodityFilter} onChange={setCommodityFilter} />
      )}

      <NetPositionPanel canEdit commodityFilter={commodityFilter} />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Active legs</div>
          <div className="mt-1 text-2xl font-medium text-foreground">{activeTrades.length}</div>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Commodities</div>
          <div className="mt-1 text-2xl font-medium text-foreground">{filteredLedger.length || filteredExposure.length}</div>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Open MTM</div>
          <div className={`mt-1 text-2xl font-medium data-grid ${totalMtm >= 0 ? "text-success" : "text-destructive"}`}>
            {formatCurrency(totalMtm, "USD")}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-3 py-2 text-sm font-medium text-foreground">MTM exposure by commodity</div>
        <table className="w-full border-collapse text-sm">
          <thead className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <tr>
              {["Commodity", "Long (MT)", "Short (MT)", "Net (MT)", "Market", "MTM P&L"].map((h) => (
                <th key={h} className="border-b border-border px-3 py-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredExposure.map((e) => (
              <tr key={e.code} className="border-b border-border/60">
                <td className="px-3 py-2 font-medium text-foreground">
                  {e.code} <span className="text-xs font-normal text-muted-foreground">{e.name}</span>
                </td>
                <td className="px-3 py-2 data-grid text-success">{formatQty(e.long)}</td>
                <td className="px-3 py-2 data-grid text-destructive">{formatQty(e.short)}</td>
                <td className="px-3 py-2 data-grid text-foreground">{formatQty(e.net)}</td>
                <td className="px-3 py-2 data-grid text-foreground">
                  {formatCurrency(e.marketPrice, e.marketCurrency ?? "USD")}
                  {e.marketUnit ? (
                    <span className="text-xs text-muted-foreground"> / {e.marketUnit}</span>
                  ) : null}
                </td>
                <td className={`px-3 py-2 data-grid ${e.mtm >= 0 ? "text-success" : "text-destructive"}`}>
                  {formatCurrency(e.mtm, "USD")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </DeskScroll>
    </DeskPage>
  );
}
