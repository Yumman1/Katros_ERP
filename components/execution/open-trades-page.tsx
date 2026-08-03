"use client";

import { PageHeader } from "@/components/ui/page-header";
import { ListPagination } from "@/components/ui/list-pagination";
import { invalidateTradeFlowCaches } from "@/lib/invalidate-caches";
import { formatQtyWithUnit } from "@/lib/formatters/numbers";
import { useListPagination } from "@/lib/use-list-pagination";
import { executionIncotermLabel, TRADE_SCOPE_LABELS } from "@/lib/trade-constants";
import { executionCanLockOpenTrade } from "@/lib/trade-lifecycle";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { Lock } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export function OpenTradesPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [lockingRef, setLockingRef] = useState<string | null>(null);
  const { data: openTrades } = trpc.execution.openTrades.useQuery(undefined, { refetchInterval: 30000 });

  const lockTrade = trpc.execution.lockOpenTrade.useMutation({
    onSuccess: (_data, variables) => {
      invalidateTradeFlowCaches(utils, variables.tradeRef);
      setLockingRef(null);
      router.push("/execution/contracts");
    },
    onError: () => setLockingRef(null),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return openTrades ?? [];
    return (openTrades ?? []).filter(
      (t) =>
        t.tradeRef.toLowerCase().includes(q) ||
        t.traderName.toLowerCase().includes(q) ||
        t.counterpartyName.toLowerCase().includes(q) ||
        t.commodityCode.toLowerCase().includes(q),
    );
  }, [openTrades, search]);

  const pagination = useListPagination(filtered, { resetKey: search });
  const awaitingTrader = filtered.filter((t) => t.pendingTraderReview).length;

  return (
    <div className="kastros-desk-page">
      <PageHeader
        breadcrumb={
          <>
            <Link href="/execution" className="hover:text-foreground">
              Desk
            </Link>
            <span>/</span>
            <span className="text-muted-foreground">Unreviewed Trades</span>
          </>
        }
        title="Unreviewed Trades"
        subtitle="Unreviewed contracts submitted by traders — edit fields, allocate warehouses, then lock when ready"
      />

      <div className="flex flex-wrap gap-3">
        <StatChip label="Unreviewed" value={filtered.length} variant="accent" />
        <StatChip label="Awaiting trader review" value={awaitingTrader} variant="danger" />
      </div>

      <input
        placeholder="Search contract, trader, counterparty, commodity…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="kastros-input w-full max-w-md rounded-xl py-2.5"
      />

      <div className="kastros-table-wrap">
        <table className="kastros-table text-xs">
          <thead>
            <tr>
              {[
                "Contract",
                "Trader",
                "Direction",
                "Qty",
                "Counterparty",
                "NTN",
                "Commodity",
                "Market",
                "Incoterm",
                "Warehouse",
                "Status",
                "",
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pagination.items.map((t) => (
              <tr key={t.tradeRef}>
                <td className="font-mono font-semibold text-accent-secondary">{t.tradeRef}</td>
                <td className="text-muted-foreground">{t.traderName}</td>
                <td>
                  <span className={t.direction === "BUY" ? "text-success" : "exec-profile-sale"}>
                    {t.direction}
                  </span>
                </td>
                <td className="tabular-nums text-muted-foreground">
                  {formatQtyWithUnit(t.quantity, t.quantityUnit, 2)}
                </td>
                <td className="text-muted-foreground">{t.counterpartyName}</td>
                <td className="font-mono text-muted-foreground">{t.counterpartyNtn ?? "—"}</td>
                <td className="text-muted-foreground">{t.commodityCode}</td>
                <td>
                  <span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase exec-badge-local">
                    {TRADE_SCOPE_LABELS[t.tradeScope ?? "LOCAL"]}
                  </span>
                </td>
                <td className="text-muted-foreground">{executionIncotermLabel(t.incoterms)}</td>
                <td>
                  {!t.requiresWarehouse ? (
                    <span className="text-subtle">N/A</span>
                  ) : t.warehouseSplitApproved ? (
                    <span className="text-success">Approved</span>
                  ) : t.pendingWarehouseApproval ? (
                    <span className="text-warning">Pending approval</span>
                  ) : (
                    <span className="text-destructive">Required</span>
                  )}
                </td>
                <td>
                  {t.pendingTraderPrice ? (
                    <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[9px] font-bold uppercase text-warning">
                      Awaiting price
                    </span>
                  ) : t.pendingTraderReview ? (
                    <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[9px] font-bold uppercase text-warning">
                      Trader review
                    </span>
                  ) : (
                    <span className="rounded-full bg-accent-secondary/15 px-2 py-0.5 text-[9px] font-bold uppercase text-accent-secondary">
                      In progress
                    </span>
                  )}
                </td>
                <td>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/execution/open-trades/${encodeURIComponent(t.tradeRef)}`}
                      className="text-[11px] font-medium text-accent-secondary hover:underline"
                    >
                      Open →
                    </Link>
                    {executionCanLockOpenTrade(t) && (
                      <button
                        type="button"
                        disabled={lockTrade.isPending}
                        onClick={() => {
                          if (!confirm(`Lock ${t.tradeRef} and move to Reviewed Trades?`)) return;
                          setLockingRef(t.tradeRef);
                          lockTrade.mutate({ tradeRef: t.tradeRef });
                        }}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-success hover:underline disabled:opacity-50"
                      >
                        <Lock className="h-3 w-3" />
                        {lockingRef === t.tradeRef && lockTrade.isPending ? "Locking…" : "Lock"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={12} className="py-12 text-center text-sm text-subtle">
                  No unreviewed trades match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <ListPagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          totalItems={pagination.totalItems}
          startIndex={pagination.startIndex}
          endIndex={pagination.endIndex}
          onPageChange={pagination.setPage}
        />
      </div>
    </div>
  );
}

function StatChip({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: "accent" | "danger";
}) {
  const shell = variant === "accent" ? "exec-stat exec-stat-accent" : "exec-stat exec-stat-danger";
  const valueClass = variant === "accent" ? "exec-stat-value-accent" : "exec-stat-value-danger";
  return (
    <div className={cn(shell, "px-4 py-2.5 text-center")}>
      <span className={cn("text-xl font-bold tabular-nums", valueClass)}>{value}</span>
      <span className="ml-2 text-xs text-subtle">{label}</span>
    </div>
  );
}
