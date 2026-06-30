"use client";

import { useEffect, useMemo, useState } from "react";
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
import { trpc } from "@/lib/trpc/client";
import type { TradeScope } from "@/lib/trade-constants";
import { kgToQuantityUnit } from "@/lib/unit-conversion";
import Link from "next/link";
import { ClipboardList } from "lucide-react";

const QUEUE_REFETCH_MS = 8000;

export function PurchaseSpotDesk({ scope }: { scope: TradeScope }) {
  const utils = trpc.useUtils();
  const [commodityFilter, setCommodityFilter] = useState("ALL");
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSuccess, setAssignSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!assignSuccess) return;
    const t = setTimeout(() => setAssignSuccess(null), 5000);
    return () => clearTimeout(t);
  }, [assignSuccess]);

  const { data: contracts, isLoading: loadingContracts } = trpc.execution.lockedContracts.useQuery(
    { profile: "PURCHASE_SPOT", tradeScope: scope },
    { refetchInterval: QUEUE_REFETCH_MS, refetchOnWindowFocus: true },
  );
  const { data: pendingTrucks, isLoading: loadingTrucks } = trpc.execution.pendingTrucks.useQuery(
    { movementType: "INBOUND" },
    { refetchInterval: QUEUE_REFETCH_MS, refetchOnWindowFocus: true },
  );
  const { data: pendingLock } = trpc.execution.pendingForLock.useQuery(undefined, {
    refetchInterval: QUEUE_REFETCH_MS,
  });
  const { data: spotPipeline } = trpc.execution.spotPipeline.useQuery(undefined, {
    refetchInterval: QUEUE_REFETCH_MS,
  });

  const assignMutation = trpc.execution.assignTruckToTrade.useMutation({
    onSuccess: (result, vars) => {
      void utils.execution.lockedContracts.invalidate();
      void utils.execution.pendingTrucks.invalidate();
      void utils.execution.inboundReceipts.invalidate();
      void utils.execution.spotPipeline.invalidate();
      void utils.execution.deskSummary.invalidate();
      setAssignError(null);
      const list =
        utils.execution.lockedContracts.getData({ profile: "PURCHASE_SPOT", tradeScope: scope }) ?? [];
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
      (pendingLock ?? []).filter(
        (t) =>
          t.direction === "BUY" &&
          t.expectedProfile === "PURCHASE_SPOT" &&
          t.tradeScope === scope,
      ),
    [pendingLock, scope],
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

  const filteredPipeline = useMemo(() => {
    const refs = new Set(filteredContracts.map((c) => c.tradeRef));
    return (spotPipeline ?? []).filter((s) => refs.has(s.tradeRef));
  }, [spotPipeline, filteredContracts]);

  if (loadingContracts || loadingTrucks) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TradeScopeHeader
        scope={scope}
        workflow="purchase-spot"
        title="Gate In — Spot Purchases"
        subtitle="Allocate gate trucks to spot orders · mandi / DC / invoice workflow per trade"
      />

      <div className="flex justify-end">
        <Link
          href="/warehouse/gatepass"
          target="_blank"
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-black"
          style={{ background: "linear-gradient(135deg,#60a5fa,#3b82f6)" }}
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

      <div className="grid grid-cols-4 gap-3">
        <StatChip
          label="Trucks waiting"
          value={filteredTrucks.filter((t) => t.status !== "ASSIGNED").length}
          color="#f59e0b"
        />
        <StatChip label="Open spot orders" value={filteredContracts.length} color="#60a5fa" />
        <StatChip label="Awaiting lock" value={filteredSpotPending.length} color="#f87171" />
        <StatChip
          label="Open volume"
          value={summarizeQtyByUnit(
            filteredContracts.map((c) => ({ qty: c.openQtyMt, unit: c.quantityUnit })),
          )}
          color="#a78bfa"
        />
      </div>

      {filteredSpotPending.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-red-400">
            Awaiting lock from trader
          </h2>
          <div className="space-y-2">
            {filteredSpotPending.map((t) => (
              <div
                key={t.tradeRef}
                className="rounded-2xl p-4"
                style={{ background: "rgba(248,113,113,0.05)", border: "1px solid rgba(248,113,113,0.2)" }}
              >
                <span className="font-mono text-sm font-bold text-red-400">{t.tradeRef}</span>
                <p className="mt-0.5 text-sm text-white">{t.counterpartyName}</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {formatQtyWithUnit(t.quantity, t.quantityUnit, 2)} · {t.commodityName} ({t.commodityCode})
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      <ManualTruckAllocation
        mode="INBOUND"
        trucks={filteredTrucks}
        contracts={filteredContracts}
        detailBasePath="/execution/purchase-spot"
        accent="#60a5fa"
        accentRgb="#60a5fa"
        isAssigning={assignMutation.isPending}
        error={assignError}
        successMessage={assignSuccess}
        onClearError={() => setAssignError(null)}
        onAssign={(truckId, tradeRef, weightKg) => {
          assignMutation.mutate({ truckId, tradeRef, overrideWeightKg: weightKg });
        }}
      />

      <SpotPipelinePanel
        contracts={filteredContracts}
        spotEvents={filteredPipeline}
        detailBasePath="/execution/purchase-spot"
      />

      <p className="text-center text-xs text-zinc-600">
        Allocated receipts update{" "}
        <Link href="/execution/inventory" className="text-amber-400 hover:underline">
          Inventory
        </Link>
        . Spot workflow steps are on each trade detail page.
      </p>
    </div>
  );
}

function StatChip({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div
      className="rounded-xl p-3 text-center"
      style={{ background: `${color}10`, border: `1px solid ${color}25` }}
    >
      <div className="text-xl font-bold tabular-nums" style={{ color }}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
    </div>
  );
}
