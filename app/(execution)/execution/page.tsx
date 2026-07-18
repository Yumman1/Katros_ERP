"use client";

import { PendingWarehousePanel } from "@/components/execution/pending-warehouse-panel";
import { PageHeader } from "@/components/ui/page-header";
import { formatQtyWithUnit } from "@/lib/formatters/numbers";
import { executionIncotermLabel } from "@/lib/trade-constants";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useMemo, useState, type ReactNode } from "react";

function contractsHref(incoterm?: string, scope?: string, commodity?: string) {
  const params = new URLSearchParams();
  if (incoterm) params.set("incoterm", incoterm);
  if (scope) params.set("scope", scope);
  if (commodity && commodity !== "ALL") params.set("commodity", commodity);
  const qs = params.toString();
  return qs ? `/execution/contracts?${qs}` : "/execution/contracts";
}

type KpiVariant = "accent" | "success" | "info" | "danger" | "muted";

const KPI_CARD: Record<KpiVariant, string> = {
  accent: "exec-kpi-accent",
  success: "exec-kpi-success",
  info: "exec-kpi-info",
  danger: "exec-kpi-danger",
  muted: "exec-kpi-muted",
};

const KPI_VALUE: Record<KpiVariant, string> = {
  accent: "text-accent-secondary",
  success: "text-success",
  info: "text-info",
  danger: "text-destructive",
  muted: "text-muted-foreground",
};

const KPI_ICON: Record<KpiVariant, string> = {
  accent: "bg-accent-secondary-muted text-accent-secondary",
  success: "bg-[color-mix(in_srgb,var(--success)_15%,transparent)] text-success",
  info: "bg-[color-mix(in_srgb,var(--info)_15%,transparent)] text-info",
  danger: "bg-[color-mix(in_srgb,var(--destructive)_15%,transparent)] text-destructive",
  muted: "bg-card text-muted-foreground",
};

export default function ExecutionDeskPage() {
  const { data: session } = useSession();
  const { data: summary } = trpc.execution.deskSummary.useQuery(undefined, { refetchInterval: 30000 });
  const { data: openTradesQueue } = trpc.execution.openTrades.useQuery(undefined, { refetchInterval: 30000 });
  const { data: allContracts } = trpc.execution.lockedContracts.useQuery({});
  const [commodityFilter, setCommodityFilter] = useState("ALL");

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const commodityOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of allContracts ?? []) map.set(c.commodityCode, c.commodityName);
    for (const t of openTradesQueue ?? []) map.set(t.commodityCode, t.commodityName);
    return [...map.entries()]
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allContracts, openTradesQueue]);

  const filteredContracts = useMemo(() => {
    if (commodityFilter === "ALL") return allContracts ?? [];
    return (allContracts ?? []).filter((c) => c.commodityCode === commodityFilter);
  }, [allContracts, commodityFilter]);

  const filteredOpenTrades = useMemo(() => {
    if (commodityFilter === "ALL") return openTradesQueue ?? [];
    return (openTradesQueue ?? []).filter((t) => t.commodityCode === commodityFilter);
  }, [openTradesQueue, commodityFilter]);

  const openContracts = filteredContracts.filter((c) => c.contractStatus === "Open");
  const localOpen = openContracts.filter((c) => c.tradeScope === "LOCAL");
  const intlOpen = openContracts.filter((c) => c.tradeScope === "INTERNATIONAL");

  const incotermCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of openContracts) {
      const key = c.incoterms || "—";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [openContracts]);

  const kpis: {
    label: string;
    value: number;
    sub: string;
    href?: string;
    variant: KpiVariant;
    icon: ReactNode;
  }[] = [
    {
      label: "In Progress",
      value: openContracts.length,
      sub: `${filteredContracts.length} total reviewed`,
      href: contractsHref(undefined, undefined, commodityFilter),
      variant: "accent",
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
    {
      label: "Local Open",
      value: localOpen.length,
      sub: "All local profiles",
      href: contractsHref(undefined, "LOCAL", commodityFilter),
      variant: "success",
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      ),
    },
    {
      label: "Intl Open",
      value: intlOpen.length,
      sub: "All international profiles",
      href: contractsHref(undefined, "INTERNATIONAL", commodityFilter),
      variant: "info",
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0h.5a2.5 2.5 0 002.5-2.5V8.935M12 12a2 2 0 104 0 2 2 0 00-4 0z" />
        </svg>
      ),
    },
    {
      label: "Unreviewed Trades",
      value: filteredOpenTrades.length,
      sub: "Awaiting execution lock",
      href: "/execution/open-trades",
      variant: filteredOpenTrades.length > 0 ? "danger" : "muted",
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      ),
    },
    {
      label: "Finance Pending",
      value: summary?.pendingFinance ?? 0,
      sub: commodityFilter === "ALL" ? "Awaiting approval" : "Global queue",
      href: "/execution/payments",
      variant: (summary?.pendingFinance ?? 0) > 0 ? "danger" : "muted",
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="kastros-desk-page">
      <PageHeader
        title={
          <>
            {greeting},{" "}
            <span className="text-accent-secondary">{session?.user?.name?.split(" ")[0] ?? "User"}</span>
          </>
        }
        subtitle={`Execution Operations · ${new Date().toLocaleDateString("en-PK", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })}`}
        actions={
          <>
            <select
              value={commodityFilter}
              onChange={(e) => setCommodityFilter(e.target.value)}
              className="exec-filter"
            >
              <option value="ALL">All commodities</option>
              {commodityOptions.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
            <Link href={contractsHref(undefined, undefined, commodityFilter)} className="kastros-btn-secondary">
              View Contracts
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => {
          const Wrapper = k.href ? Link : "div";
          return (
            <Wrapper
              key={k.label}
              href={k.href as string}
              className={cn("exec-kpi group border", KPI_CARD[k.variant])}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="exec-kpi-label">{k.label}</p>
                  <p className={cn("exec-kpi-value mt-1", KPI_VALUE[k.variant])}>{k.value}</p>
                  <p className="exec-kpi-sub">{k.sub}</p>
                </div>
                <div className={cn("rounded-xl p-2.5", KPI_ICON[k.variant])}>{k.icon}</div>
              </div>
              {k.href && (
                <p className={cn("mt-3 text-xs font-medium group-hover:underline", KPI_VALUE[k.variant])}>
                  View →
                </p>
              )}
            </Wrapper>
          );
        })}
      </div>

      <div className="kastros-desk-scroll flex flex-col gap-4">
      <section className="exec-panel">
        <h2 className="text-sm font-semibold text-foreground">Open contracts by incoterm</h2>
        <p className="mt-1 text-xs text-subtle">
          Each trade is categorized by its own incoterm. Click one to see its contracts.
        </p>
        {incotermCounts.length === 0 ? (
          <p className="mt-3 text-xs text-subtle">No open contracts yet.</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {incotermCounts.map(([term, count]) => (
              <Link
                key={term}
                href={contractsHref(term, undefined, commodityFilter)}
                className="flex items-center gap-2 rounded-xl border border-accent/30 bg-accent-muted px-3 py-2 text-xs font-medium text-accent transition-colors hover:opacity-90"
                title={executionIncotermLabel(term)}
              >
                <span>{executionIncotermLabel(term)}</span>
                <span className="rounded-full bg-accent-muted px-2 py-0.5 text-[10px] font-bold tabular-nums">
                  {count}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <PendingWarehousePanel compact />

      {(filteredOpenTrades.length ?? 0) > 0 && (
        <section className="exec-alert-warning">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-warning">
              {filteredOpenTrades.length} open trade{filteredOpenTrades.length !== 1 ? "s" : ""} in queue
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Review, edit, allocate warehouse, and lock — or send edits back to the trader for approval.
          </p>
          <ul className="mt-2 space-y-1">
            {filteredOpenTrades.slice(0, 5).map((t) => (
              <li key={t.tradeRef} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Link
                  href={`/execution/open-trades/${encodeURIComponent(t.tradeRef)}`}
                  className="font-mono font-semibold text-accent-secondary hover:underline"
                >
                  {t.tradeRef}
                </Link>
                <span>{t.counterpartyName}</span>
                <span>{formatQtyWithUnit(t.quantity, t.quantityUnit, 2)}</span>
                {t.pendingTraderReview && (
                  <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">
                    Trader review
                  </span>
                )}
              </li>
            ))}
          </ul>
          <Link
            href="/execution/open-trades"
            className="mt-2 inline-block text-xs font-medium text-accent-secondary hover:underline"
          >
            Unreviewed trades →
          </Link>
        </section>
      )}

      <section className="exec-panel flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Contract monitoring</h2>
          <p className="mt-1 text-xs text-subtle">
            {filteredContracts.length} reviewed · {openContracts.length} in progress. Full details in Reviewed Trades.
          </p>
        </div>
        <Link href={contractsHref(undefined, undefined, commodityFilter)} className="kastros-btn-primary">
          Open Reviewed Trades →
        </Link>
      </section>
      </div>
    </div>
  );
}
