"use client";

import { PageHeader } from "@/components/ui/page-header";
import { OverdueAlertsCard } from "@/components/ledgers/overdue-alerts-card";
import { LocationCommodityTable } from "@/components/inventory/location-commodity-table";
import { WarehouseStorageMetricsPreview } from "@/components/execution/warehouse-storage-metrics-preview";
import { trpc } from "@/lib/trpc/client";
import Link from "next/link";
import { cn } from "@/lib/utils";

export default function CeoOverviewPage() {
  const { data, isLoading, error } = trpc.ceo.dashboardSummary.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-5 py-8 text-sm text-destructive">
        Could not load executive overview: {error.message}
      </div>
    );
  }

  return (
    <div className="kastros-desk-page">
      <PageHeader
        title="Executive overview"
        subtitle="Company-wide inventory, storage capacity, and locked trade progress."
        actions={
          data?.pendingApprovals ? (
            <Link href="/ceo/approvals" className="kastros-btn-primary text-xs">
              {data.pendingApprovals} pending approval{data.pendingApprovals === 1 ? "" : "s"}
            </Link>
          ) : null
        }
      />

      <OverdueAlertsCard />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Warehouses" value={isLoading ? "…" : String(data?.warehouseCount ?? 0)} />
        <Kpi label="Net inventory (MT)" value={isLoading ? "…" : (data?.totalNetMt ?? 0).toFixed(1)} />
        <Kpi
          label="Open locked trades"
          value={isLoading ? "…" : String(data?.openLockedCount ?? 0)}
          accent="warning"
        />
        <Kpi
          label="Avg fulfillment"
          value={isLoading ? "…" : data ? `${(data.avgFulfillmentPct * 100).toFixed(0)}%` : "0%"}
          accent="success"
        />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Network storage capacity</h2>
        {isLoading ? (
          <p className="text-sm text-subtle">Loading storage metrics…</p>
        ) : data?.storageNetwork ? (
          <WarehouseStorageMetricsPreview summary={data.storageNetwork} />
        ) : (
          <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            No storage capacity configured on company warehouses yet.
          </div>
        )}
      </div>

      <LocationCommodityTable rows={data?.inventoryRows ?? []} loading={isLoading} />

      <section className="rounded-xl border border-border bg-card px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">Locked trades snapshot</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {data?.lockedTradeCount ?? 0} locked total · {data?.openLockedCount ?? 0} still open ·{" "}
          {(data?.totalUnallocatedMt ?? 0).toFixed(1)} MT unallocated on gatepass
        </p>
        <p className="mt-3 text-xs text-subtle">
          Traders request manual close from their fulfillment desk; warehouse creation flows through execution then CEO
          approval.
        </p>
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "success" | "warning";
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-subtle">{label}</div>
      <div
        className={cn(
          "mt-1 text-2xl font-bold tabular-nums",
          accent === "success" && "text-success",
          accent === "warning" && "text-warning",
          !accent && "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}
