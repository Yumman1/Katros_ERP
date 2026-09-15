"use client";

import { useRecordFilters } from "@/components/ui/record-filters";
import { field, tradeFields, tradeFilterConfig } from "@/lib/record-filters";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CommodityFilterBar } from "@/components/execution/commodity-filter-bar";
import { ManualTruckAllocation } from "@/components/execution/manual-truck-allocation";
import { SpotPipelinePanel } from "@/components/execution/spot-pipeline-panel";
import { TradeScopeHeader } from "@/components/execution/trade-scope-header";
import { summarizeQtyByUnit } from "@/lib/formatters/execution-units";
import { formatQtyWithUnit } from "@/lib/formatters/numbers";
import {
  collectDeskCommodityOptions,
  matchesCommodityFilter,
} from "@/lib/execution-commodity-filter";
import { DESK_REFETCH_MS, invalidateGateOpsCaches } from "@/lib/invalidate-caches";
import { trpc } from "@/lib/trpc/client";
import type { TradeScope } from "@/lib/trade-constants";
import { kgToQuantityUnit } from "@/lib/unit-conversion";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { ListPagination } from "@/components/ui/list-pagination";
import { useListPagination } from "@/lib/use-list-pagination";

type ExecutionProfile = "PURCHASE_SPOT" | "PURCHASE_DELIVERED" | "SALE_EX_WAREHOUSE";

export type ExecutionProfileDeskConfig = {
  profile: ExecutionProfile;
  movementType: "INBOUND" | "OUTBOUND";
  warehouseAllocated?: boolean;
  workflow: "purchase-spot" | "purchase-delivered" | "sales";
  title: string;
  subtitle: string;
  detailBasePath: string;
  accentVariant: "info" | "success" | "warning";
  openOrdersLabel: string;
  openOrdersVariant: "accent" | "success" | "info";
  inventoryFooter: ReactNode;
  showSpotExtras?: boolean;
};

export function ExecutionProfileDesk({
  scope,
  config,
}: {
  scope: TradeScope;
  config: ExecutionProfileDeskConfig;
}) {
  const utils = trpc.useUtils();
  const [commodityFilter, setCommodityFilter] = useState("ALL");
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSuccess, setAssignSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!assignSuccess) return;
    const t = setTimeout(() => setAssignSuccess(null), 5000);
    return () => clearTimeout(t);
  }, [assignSuccess]);

  const contractQuery = {
    profile: config.profile,
    tradeScope: scope,
    ...(config.warehouseAllocated ? { warehouseAllocated: true as const } : {}),
  };

  const { data: contracts, isLoading: loadingContracts } = trpc.execution.lockedContracts.useQuery(
    contractQuery,
    { refetchInterval: DESK_REFETCH_MS },
  );
  const { data: pendingTrucks, isLoading: loadingTrucks } = trpc.execution.pendingTrucks.useQuery(
    { movementType: config.movementType },
    { refetchInterval: DESK_REFETCH_MS },
  );
  const { data: pendingLock } = trpc.execution.pendingForLock.useQuery(undefined, {
    refetchInterval: DESK_REFETCH_MS,
    enabled: !!config.showSpotExtras,
  });
  const { data: spotPipeline } = trpc.execution.spotPipeline.useQuery(undefined, {
    refetchInterval: DESK_REFETCH_MS,
    enabled: !!config.showSpotExtras,
  });

  const assignMutation = trpc.execution.assignTruckToTrade.useMutation({
    onSuccess: (result, vars) => {
      invalidateGateOpsCaches(utils);
      setAssignError(null);
      const list = utils.execution.lockedContracts.getData(contractQuery) ?? [];
      const contract = list.find((c) => c.tradeRef === vars.tradeRef);
      const unit = contract?.quantityUnit ?? "MT";
      const qty = kgToQuantityUnit(vars.overrideWeightKg ?? 0, unit);
      setAssignSuccess(
        `Allocated ${formatQtyWithUnit(qty, unit, 2)} to ${vars.tradeRef}` +
          (result.splitRemainingKg > 0.5
            ? ` · ${formatQtyWithUnit(result.splitRemainingKg, "KG", 0)} still on truck`
            : " · truck fully assigned"),
      );
    },
    onError: (e) => setAssignError(e.message),
  });

  const openContracts = useMemo(
    () => (contracts ?? []).filter((c) => c.contractStatus === "Open"),
    [contracts],
  );

  const spotPending = useMemo(
    () =>
      config.showSpotExtras
        ? (pendingLock ?? []).filter(
            (t) =>
              t.direction === "BUY" &&
              t.expectedProfile === "PURCHASE_SPOT" &&
              t.tradeScope === scope,
          )
        : [],
    [config.showSpotExtras, pendingLock, scope],
  );

  const commodityOptions = useMemo(
    () =>
      collectDeskCommodityOptions({
        contracts: openContracts,
        trucks: pendingTrucks ?? [],
      }),
    [openContracts, pendingTrucks],
  );

  useEffect(() => {
    if (commodityFilter === "ALL") return;
    if (!commodityOptions.some((c) => c.code === commodityFilter)) {
      setCommodityFilter("ALL");
    }
  }, [commodityFilter, commodityOptions]);

  const filteredContracts = useMemo(
    () => openContracts.filter((c) => matchesCommodityFilter(c.commodityCode, commodityFilter)),
    [openContracts, commodityFilter],
  );

  const filteredTrucks = useMemo(
    () =>
      (pendingTrucks ?? []).filter((t) => matchesCommodityFilter(t.commodityCode, commodityFilter)),
    [pendingTrucks, commodityFilter],
  );

  const filteredSpotPending = useMemo(
    () => spotPending.filter((t) => matchesCommodityFilter(t.commodityCode, commodityFilter)),
    [spotPending, commodityFilter],
  );
  const lockFilters = useRecordFilters("pending-lock", filteredSpotPending, { date: tradeFilterConfig.date, fields: [tradeFields[3], field("trader", "Trader", "traderName")] });
  const spotPendingPagination = useListPagination(lockFilters.rows, { resetKey: commodityFilter + lockFilters.resetKey });

  const filteredPipeline = useMemo(() => {
    if (!config.showSpotExtras) return [];
    const refs = new Set(filteredContracts.map((c) => c.tradeRef));
    return (spotPipeline ?? []).filter((s) => refs.has(s.tradeRef));
  }, [config.showSpotExtras, spotPipeline, filteredContracts]);

  if (loadingContracts || loadingTrucks) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-subtle">Loading…</div>
    );
  }

  return (
    <div className="kastros-desk-page">
      <TradeScopeHeader
        scope={scope}
        workflow={config.workflow}
        title={config.title}
        subtitle={config.subtitle}
      />

      <div className="flex justify-end">
        <Link
          href="/warehouse/gatepass"
          target="_blank"
          className="kastros-btn-primary inline-flex items-center gap-2"
        >
          <ClipboardList className="h-4 w-4" />
          Gatepass
        </Link>
      </div>

      <CommodityFilterBar
        commodities={commodityOptions}
        value={commodityFilter}
        onChange={setCommodityFilter}
      />

      <div className={`grid gap-3 ${config.showSpotExtras ? "grid-cols-4" : "grid-cols-3"}`}>
        <StatChip
          label="Trucks waiting"
          value={filteredTrucks.filter((t) => t.status !== "ASSIGNED").length}
          variant="accent"
        />
        <StatChip
          label={config.openOrdersLabel}
          value={filteredContracts.length}
          variant={config.openOrdersVariant}
        />
        {config.showSpotExtras && (
          <StatChip label="Awaiting lock" value={filteredSpotPending.length} variant="danger" />
        )}
        <StatChip
          label="Open volume"
          value={summarizeQtyByUnit(
            filteredContracts.map((c) => ({ qty: c.openQtyMt, unit: c.quantityUnit })),
          )}
          variant={config.showSpotExtras ? "success" : "info"}
        />
      </div>

      {config.showSpotExtras && filteredSpotPending.length > 0 && (
        <section className="exec-alert-danger">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-destructive">
            Awaiting lock from trader
          </h2>
          {lockFilters.controls}
          <div className="space-y-2">
            {spotPendingPagination.items.map((t) => (
              <div key={t.tradeRef} className="exec-panel">
                <span className="font-mono text-sm font-bold text-destructive">{t.tradeRef}</span>
                <p className="mt-0.5 text-sm text-foreground">{t.counterpartyName}</p>
                <p className="mt-0.5 text-xs text-subtle">
                  {formatQtyWithUnit(t.quantity, t.quantityUnit, 2)} · {t.commodityName} ({t.commodityCode})
                </p>
              </div>
            ))}
          </div>
          <ListPagination
            page={spotPendingPagination.page}
            totalPages={spotPendingPagination.totalPages}
            totalItems={spotPendingPagination.totalItems}
            startIndex={spotPendingPagination.startIndex}
            endIndex={spotPendingPagination.endIndex}
            onPageChange={spotPendingPagination.setPage}
          />
        </section>
      )}

      <ManualTruckAllocation
        mode={config.movementType}
        trucks={filteredTrucks}
        contracts={filteredContracts}
        detailBasePath={config.detailBasePath}
        accentVariant={config.accentVariant}
        isAssigning={assignMutation.isPending}
        error={assignError}
        successMessage={assignSuccess}
        onClearError={() => setAssignError(null)}
        onAssign={(truckId, tradeRef, weightKg) => {
          assignMutation.mutate({ truckId, tradeRef, overrideWeightKg: weightKg });
        }}
      />

      {config.showSpotExtras && (
        <SpotPipelinePanel
          contracts={filteredContracts}
          spotEvents={filteredPipeline}
          detailBasePath={config.detailBasePath}
        />
      )}

      <p className="text-center text-xs text-subtle">{config.inventoryFooter}</p>
    </div>
  );
}

function StatChip({
  label,
  value,
  variant,
}: {
  label: string;
  value: string | number;
  variant: "accent" | "info" | "danger" | "success";
}) {
  const shell = {
    accent: "exec-stat exec-stat-accent",
    info: "exec-stat exec-stat-info",
    danger: "exec-stat exec-stat-danger",
    success: "exec-stat exec-stat-success",
  }[variant];
  const valueClass = {
    accent: "exec-stat-value-accent",
    info: "exec-stat-value-info",
    danger: "exec-stat-value-danger",
    success: "exec-stat-value-success",
  }[variant];

  return (
    <div className={`${shell} p-3 text-center`}>
      <div className={`text-xl font-bold tabular-nums ${valueClass}`}>{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-subtle">{label}</div>
    </div>
  );
}
