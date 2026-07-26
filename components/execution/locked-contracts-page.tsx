"use client";

import { ClosedTradesSection } from "@/components/execution/closed-trades-section";
import { ListPagination } from "@/components/ui/list-pagination";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";
import {
  collectCommodityOptions,
  matchesCommodityFilter,
} from "@/lib/execution-commodity-filter";
import { trpc } from "@/lib/trpc/client";
import { executionWorkspacePath } from "@/lib/execution-routes";
import { formatLockedContractRate } from "@/lib/formatters/contract-rate";
import { formatQtyWithUnit } from "@/lib/formatters/numbers";
import {
  allocationSummaryLabel,
  contractHasWarehouseAllocation,
} from "@/lib/warehouse-allocation";
import {
  executionIncotermLabel,
  executionTypeLabel,
  INCOTERMS,
  TRADE_SCOPES,
  TRADE_SCOPE_LABELS,
} from "@/lib/trade-constants";
import { deliveryWindowStatus, DELIVERY_WINDOW_TONE } from "@/lib/delivery-window";
import { cn } from "@/lib/utils";
import { useListPagination } from "@/lib/use-list-pagination";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

/** Fits content area below app shell header + main padding. */
const PAGE_HEIGHT = "kastros-desk-page";

const PROFILE_CLASS: Record<string, string> = {
  PURCHASE_DELIVERED: "exec-profile-purchase-delivered",
  PURCHASE_SPOT: "exec-profile-purchase-spot",
  SALE_EX_WAREHOUSE: "exec-profile-sale",
};

const PROFILE_BAR: Record<string, string> = {
  PURCHASE_DELIVERED: "var(--success)",
  PURCHASE_SPOT: "var(--info)",
  SALE_EX_WAREHOUSE: "#a78bfa",
};

export function LockedContractsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [incoterm, setIncoterm] = useState(() => searchParams.get("incoterm") ?? "");
  const [scopeFilter, setScopeFilter] = useState(() => searchParams.get("scope") ?? "");
  const [commodityFilter, setCommodityFilter] = useState(() => searchParams.get("commodity") ?? "ALL");
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  // Single source of truth for the In Progress / Closed split. `?status=Close`
  // from older links still lands on the Closed tab.
  const [viewTab, setViewTab] = useState<"contracts" | "closed">(() =>
    searchParams.get("status") === "Close" ? "closed" : "contracts",
  );

  const syncUrl = useCallback(
    (next: {
      incoterm: string;
      scope: string;
      commodity: string;
      q: string;
      status: "contracts" | "closed";
    }) => {
      const params = new URLSearchParams();
      if (next.incoterm) params.set("incoterm", next.incoterm);
      if (next.scope) params.set("scope", next.scope);
      if (next.commodity && next.commodity !== "ALL") params.set("commodity", next.commodity);
      if (next.q) params.set("q", next.q);
      if (next.status === "closed") params.set("status", "Close");
      const qs = params.toString();
      router.replace(qs ? `/execution/contracts?${qs}` : "/execution/contracts", { scroll: false });
    },
    [router],
  );

  useEffect(() => {
    syncUrl({ incoterm, scope: scopeFilter, commodity: commodityFilter, q: search, status: viewTab });
  }, [incoterm, scopeFilter, commodityFilter, search, viewTab, syncUrl]);

  const { data: contracts, isLoading } = trpc.execution.lockedContracts.useQuery({
    openOnly: false,
    incoterms: incoterm || undefined,
    tradeScope: scopeFilter ? (scopeFilter as (typeof TRADE_SCOPES)[number]) : undefined,
  });

  const commodityOptions = useMemo(
    () => collectCommodityOptions(contracts ?? []),
    [contracts],
  );

  const filtered = (contracts ?? []).filter((c) => {
    const matchSearch =
      !search ||
      c.tradeRef.toLowerCase().includes(search.toLowerCase()) ||
      c.counterpartyName.toLowerCase().includes(search.toLowerCase()) ||
      c.commodityCode.toLowerCase().includes(search.toLowerCase()) ||
      c.commodityName.toLowerCase().includes(search.toLowerCase());
    // The In Progress tab shows in-progress contracts only — closed ones live
    // in the Closed tab, so the tab count and the row count always agree.
    const matchStatus = c.contractStatus === "Open";
    const matchCommodity = matchesCommodityFilter(c.commodityCode, commodityFilter);
    return matchSearch && matchStatus && matchCommodity;
  });

  const filterKey = `${incoterm}|${scopeFilter}|${commodityFilter}|${search}`;
  const contractsPagination = useListPagination(filtered, { resetKey: filterKey, pageSize: 6 });

  const totalOpen = (contracts ?? []).filter((c) => c.contractStatus === "Open").length;
  const totalClosedCount = (contracts ?? []).filter((c) => c.contractStatus !== "Open").length;

  const hasActiveFilters =
    incoterm !== "" || scopeFilter !== "" || commodityFilter !== "ALL" || search !== "";

  const clearFilters = () => {
    setIncoterm("");
    setScopeFilter("");
    setCommodityFilter("ALL");
    setSearch("");
  };

  if (isLoading && !contracts) {
    return (
      <div className={cn("flex min-h-0 flex-col gap-2 overflow-hidden", PAGE_HEIGHT)}>
        <PageLoadingSkeleton label="Loading reviewed trades…" rows={8} />
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-col gap-2 overflow-hidden", PAGE_HEIGHT)}>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex items-center gap-2 text-xs text-subtle">
          <Link href="/execution" className="hover:text-foreground">
            Desk
          </Link>
          <span>/</span>
          <span className="font-medium text-foreground">Reviewed Trades</span>
        </div>
        <div className="exec-segment h-7">
          {(
            [
              { id: "contracts" as const, label: `In Progress (${totalOpen})` },
              { id: "closed" as const, label: `Closed (${totalClosedCount})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setViewTab(tab.id)}
              className={cn("exec-segment-item px-2 py-0.5 text-xs", viewTab === tab.id && "exec-segment-active")}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {viewTab === "contracts" && (
          <span className="text-[11px] text-subtle">
            {filtered.length} shown{hasActiveFilters ? " · filtered" : ""}
          </span>
        )}
      </div>

      {viewTab === "closed" ? (
        <ClosedTradesSection contracts={contracts ?? []} compact className="min-h-0 flex-1" />
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <input
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="kastros-input h-7 min-w-[120px] flex-1 rounded-md py-0 text-xs"
            />
            <select
              value={commodityFilter}
              onChange={(e) => setCommodityFilter(e.target.value)}
              className="exec-filter h-7 max-w-[130px] py-0 text-xs"
            >
              <option value="ALL">All commodities</option>
              {commodityOptions.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
            <select
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value)}
              className="exec-filter h-7 max-w-[110px] py-0 text-xs"
            >
              <option value="">All markets</option>
              {TRADE_SCOPES.map((s) => (
                <option key={s} value={s}>
                  {TRADE_SCOPE_LABELS[s]}
                </option>
              ))}
            </select>
            <select
              value={incoterm}
              onChange={(e) => setIncoterm(e.target.value)}
              className="exec-filter h-7 max-w-[120px] py-0 text-xs"
            >
              <option value="">All incoterms</option>
              {INCOTERMS.map((i) => (
                <option key={i} value={i}>
                  {executionIncotermLabel(i)}
                </option>
              ))}
            </select>
            {hasActiveFilters && (
              <button type="button" onClick={clearFilters} className="kastros-btn-secondary px-2 py-0.5 text-xs">
                Clear
              </button>
            )}
          </div>

          <div className="kastros-table-wrap flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="kastros-table text-[11px] [&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-[10px]">
                <thead className="sticky top-0 z-10 bg-[var(--brand-muted)]">
                  <tr>
                    {[
                      "Contract",
                      "Type",
                      "Cmdty",
                      "Rate",
                      "Counterparty",
                      "Wh",
                      "Qty",
                      "Rcvd",
                      "Open",
                      "%",
                      "Del.",
                      "St.",
                      "",
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {contractsPagination.items.map((c) => {
                    const pct = c.contractualQtyMt > 0 ? Math.min(c.receivedQtyMt / c.contractualQtyMt, 1) : 0;
                    const profileClass = PROFILE_CLASS[c.executionProfile] ?? "text-muted-foreground";
                    const dw = deliveryWindowStatus(c.deliveryStart, c.deliveryEnd, {
                      fulfilled: c.contractStatus !== "Open",
                    });
                    const dwTone = DELIVERY_WINDOW_TONE[dw.state];
                    const usesWarehouse =
                      c.executionProfile === "PURCHASE_DELIVERED" ||
                      c.executionProfile === "SALE_EX_WAREHOUSE";
                    const warehouseLabel = usesWarehouse
                      ? contractHasWarehouseAllocation(c)
                        ? allocationSummaryLabel(c, c.quantityUnit)
                        : "Not allocated"
                      : null;
                    return (
                      <tr key={c.tradeRef}>
                        <td className={cn("font-mono font-semibold whitespace-nowrap", profileClass)}>
                          {c.tradeRef}
                        </td>
                        <td>
                          <span
                            className={cn(
                              "whitespace-nowrap rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase",
                              profileClass,
                              "bg-[color-mix(in_srgb,currentColor_12%,transparent)]",
                            )}
                            title={`${TRADE_SCOPE_LABELS[c.tradeScope]} · ${c.incoterms}`}
                          >
                            {executionTypeLabel(c.tradeScope, c.executionProfile, c.incoterms)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap font-medium">{c.commodityCode}</td>
                        <td
                          className="whitespace-nowrap tabular-nums text-muted-foreground"
                          title="Locked trade rate"
                        >
                          {formatLockedContractRate(c)}
                        </td>
                        <td className="max-w-[100px] truncate text-muted-foreground" title={c.counterpartyName}>
                          {c.counterpartyName}
                        </td>
                        <td className="max-w-[80px]">
                          {usesWarehouse ? (
                            <span
                              className={cn(
                                "block truncate text-[10px]",
                                warehouseLabel === "Not allocated" ? "text-destructive" : "text-muted-foreground",
                              )}
                              title={warehouseLabel ?? undefined}
                            >
                              {warehouseLabel}
                            </span>
                          ) : (
                            <span className="text-subtle">—</span>
                          )}
                        </td>
                        <td className="tabular-nums whitespace-nowrap text-muted-foreground">
                          {formatQtyWithUnit(c.contractualQtyMt, c.quantityUnit, 0)}
                        </td>
                        <td className="tabular-nums whitespace-nowrap text-muted-foreground">
                          {formatQtyWithUnit(c.receivedQtyMt, c.quantityUnit, 0)}
                        </td>
                        <td className="tabular-nums whitespace-nowrap text-muted-foreground">
                          {formatQtyWithUnit(c.openQtyMt, c.quantityUnit, 0)}
                        </td>
                        <td>
                          <div className="flex items-center gap-1">
                            <div className="h-1 w-8 rounded-full bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)]">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${pct * 100}%`,
                                  background: PROFILE_BAR[c.executionProfile] ?? "var(--muted-foreground)",
                                }}
                              />
                            </div>
                            <span className="tabular-nums text-[10px] text-subtle">{(pct * 100).toFixed(0)}</span>
                          </div>
                        </td>
                        <td>
                          <span
                            className="whitespace-nowrap rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase"
                            style={{ background: dwTone.bg, color: dwTone.color }}
                            title={
                              c.deliveryStart || c.deliveryEnd
                                ? `Delivery ${c.deliveryStart ? new Date(c.deliveryStart).toISOString().slice(0, 10) : "?"} → ${c.deliveryEnd ? new Date(c.deliveryEnd).toISOString().slice(0, 10) : "?"}`
                                : "No delivery window"
                            }
                          >
                            {dw.label}
                          </span>
                        </td>
                        <td>
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase",
                              c.contractStatus === "Open" ? "exec-badge-open" : "exec-badge-closed",
                            )}
                          >
                            {c.contractStatus === "Open" ? "Open" : "Closed"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <Link
                              href={executionWorkspacePath(c.tradeRef, c.executionProfile)}
                              className={cn("text-[10px] font-medium hover:underline", profileClass)}
                            >
                              Open
                            </Link>
                            {c.contractStatus === "Open" && (
                              <Link
                                href={`/execution/contracts/${encodeURIComponent(c.tradeRef)}/edit`}
                                className="text-[10px] font-medium text-brand hover:underline"
                              >
                                Edit
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={13} className="py-6 text-center text-sm text-subtle">
                        No contracts match your filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <ListPagination
              page={contractsPagination.page}
              totalPages={contractsPagination.totalPages}
              totalItems={contractsPagination.totalItems}
              startIndex={contractsPagination.startIndex}
              endIndex={contractsPagination.endIndex}
              onPageChange={contractsPagination.setPage}
              className="shrink-0 px-3 py-2"
            />
          </div>
        </>
      )}
    </div>
  );
}
