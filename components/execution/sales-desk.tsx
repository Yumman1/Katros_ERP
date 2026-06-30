"use client";

import { useEffect, useMemo, useState } from "react";
import { CommodityFilterBar } from "@/components/execution/commodity-filter-bar";
import { ManualTruckAllocation } from "@/components/execution/manual-truck-allocation";
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

export function SalesDesk({ scope }: { scope: TradeScope }) {
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
    { profile: "SALE_EX_WAREHOUSE", tradeScope: scope },
    { refetchInterval: QUEUE_REFETCH_MS, refetchOnWindowFocus: true },
  );
  const { data: pendingTrucks, isLoading: loadingTrucks } = trpc.execution.pendingTrucks.useQuery(
    { movementType: "OUTBOUND" },
    { refetchInterval: QUEUE_REFETCH_MS, refetchOnWindowFocus: true },
  );

  const assignMutation = trpc.execution.assignTruckToTrade.useMutation({
    onSuccess: (result, vars) => {
      void utils.execution.lockedContracts.invalidate();
      void utils.execution.pendingTrucks.invalidate();
      void utils.execution.outboundDispatches.invalidate();
      void utils.execution.deskSummary.invalidate();
      setAssignError(null);
      const list =
        utils.execution.lockedContracts.getData({
          profile: "SALE_EX_WAREHOUSE",
          tradeScope: scope,
        }) ?? [];
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
        workflow="sales"
        title="Gate Out — Ex-Warehouse Sales"
        subtitle="Trucks leaving the warehouse · assign to open sale orders"
      />

      <div className="flex justify-end">
        <Link
          href="/warehouse/gatepass"
          target="_blank"
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-black"
          style={{ background: "linear-gradient(135deg,#f59e0b,#d97706)" }}
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

      <div className="grid grid-cols-3 gap-3">
        <StatChip
          label="Trucks waiting"
          value={filteredTrucks.filter((t) => t.status !== "ASSIGNED").length}
          color="#f59e0b"
        />
        <StatChip label="Open sale orders" value={filteredContracts.length} color="#f59e0b" />
        <StatChip
          label="Open volume"
          value={summarizeQtyByUnit(
            filteredContracts.map((c) => ({ qty: c.openQtyMt, unit: c.quantityUnit })),
          )}
          color="#60a5fa"
        />
      </div>

      <ManualTruckAllocation
        mode="OUTBOUND"
        trucks={filteredTrucks}
        contracts={filteredContracts}
        detailBasePath="/execution/sales"
        accent="#f59e0b"
        accentRgb="#f59e0b"
        isAssigning={assignMutation.isPending}
        error={assignError}
        successMessage={assignSuccess}
        onClearError={() => setAssignError(null)}
        onAssign={(truckId, tradeRef, weightKg) => {
          assignMutation.mutate({ truckId, tradeRef, overrideWeightKg: weightKg });
        }}
      />

      <p className="text-center text-xs text-zinc-600">
        Allocated dispatches update{" "}
        <Link href="/execution/inventory" className="text-amber-400 hover:underline">
          Inventory
        </Link>{" "}
        for that warehouse and commodity.
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
