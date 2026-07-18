"use client";

import { DeskPage, DeskScroll } from "@/components/layout/desk-page";
import { trpc } from "@/lib/trpc/client";
import { formatCurrency } from "@/lib/formatters/numbers";

export default function TraderMarketPage() {
  const { data: prices, isLoading } = trpc.market.snapshot.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  return (
    <DeskPage>
      <DeskScroll className="space-y-5 pb-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Market Watch</h1>
        <p className="text-sm text-subtle">
          Desk prices from execution — CNF where applicable, plus yesterday&apos;s local level. Each can be in its own
          currency and unit.
        </p>
      </div>

      {isLoading ? (
        <div className="text-subtle">Loading desk prices…</div>
      ) : !prices?.length ? (
        <div className="rounded-lg border border-kastros-border bg-kastros-card p-6 text-sm text-subtle">
          No desk prices published yet. Execution will update Daily Prices when available.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {prices.map((p) => {
            const chg = p.chgPct;
            return (
              <div key={p.code} className="rounded-lg border border-kastros-border bg-kastros-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-lg font-semibold text-foreground">{p.code}</div>
                    <div className="text-xs text-subtle">{p.name}</div>
                  </div>
                  {chg != null && (
                    <span
                      className={`text-xs font-medium ${chg >= 0 ? "text-success" : "text-kastros-red"}`}
                    >
                      {chg >= 0 ? "+" : ""}
                      {chg.toFixed(2)}%
                    </span>
                  )}
                </div>

                {p.cnf != null && p.cnfCurrency && p.cnfUnit ? (
                  <div className="mt-3">
                    <div className="text-[10px] uppercase tracking-wider text-subtle">CNF</div>
                    <div className="data-grid text-xl font-medium text-foreground">
                      {formatCurrency(p.cnf, p.cnfCurrency)}
                      <span className="ml-1 text-sm text-subtle">/ {p.cnfUnit}</span>
                    </div>
                  </div>
                ) : null}

                {p.yesterdayRate != null && p.yesterdayCurrency && p.yesterdayUnit ? (
                  <div className={`${p.cnf != null ? "mt-3 border-t border-kastros-border/60 pt-3" : "mt-3"}`}>
                    <div className="text-[10px] uppercase tracking-wider text-subtle">Yesterday (local)</div>
                    <div className="data-grid text-xl font-medium text-foreground">
                      {formatCurrency(p.yesterdayRate, p.yesterdayCurrency)}
                      <span className="ml-1 text-sm text-subtle">/ {p.yesterdayUnit}</span>
                    </div>
                  </div>
                ) : null}

                {chg == null && p.cnf != null && p.yesterdayRate != null && (
                  <div className="mt-2 text-[10px] text-subtle">
                    % change not shown — CNF and yesterday use different currency or unit.
                  </div>
                )}

                <div className="mt-2 text-[10px] text-subtle">
                  Execution desk · {p.priceDate}
                  {p.asOf ? ` · ${new Date(p.asOf).toLocaleTimeString()}` : ""}
                </div>
              </div>
            );
          })}
        </div>
      )}
      </DeskScroll>
    </DeskPage>
  );
}
