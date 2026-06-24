"use client";

import { useState, useEffect } from "react";
import { ManualTruckAllocation } from "@/components/execution/manual-truck-allocation";
import { summarizeQtyByUnit } from "@/lib/formatters/execution-units";
import { formatQtyWithUnit } from "@/lib/formatters/numbers";
import { trpc } from "@/lib/trpc/client";
import { kgToQuantityUnit } from "@/lib/unit-conversion";
import Link from "next/link";
import { ClipboardList } from "lucide-react";

const QUEUE_REFETCH_MS = 8000;

export default function PurchaseDeliveredPage() {
  const utils = trpc.useUtils();
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSuccess, setAssignSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!assignSuccess) return;
    const t = setTimeout(() => setAssignSuccess(null), 5000);
    return () => clearTimeout(t);
  }, [assignSuccess]);

  const { data: contracts, isLoading: loadingContracts } = trpc.execution.lockedContracts.useQuery(
    { profile: "PURCHASE_DELIVERED" },
    { refetchInterval: QUEUE_REFETCH_MS, refetchOnWindowFocus: true },
  );
  const { data: pendingTrucks, isLoading: loadingTrucks } = trpc.execution.pendingTrucks.useQuery(
    { movementType: "INBOUND" },
    { refetchInterval: QUEUE_REFETCH_MS, refetchOnWindowFocus: true },
  );

  const assignMutation = trpc.execution.assignTruckToTrade.useMutation({
    onSuccess: (result, vars) => {
      void utils.execution.lockedContracts.invalidate();
      void utils.execution.pendingTrucks.invalidate();
      void utils.execution.inboundReceipts.invalidate();
      void utils.execution.deskSummary.invalidate();
      setAssignError(null);
      const contract = openContracts.find((c) => c.tradeRef === vars.tradeRef);
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

  const openContracts = (contracts ?? []).filter((c) => c.contractStatus === "Open");

  if (loadingContracts || loadingTrucks) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-xs font-medium text-zinc-500">
          <Link href="/execution" className="hover:text-white">
            Desk
          </Link>
          <span>/</span>
          <span className="text-zinc-400">Purchase — Delivered</span>
        </div>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Gate In — Allocate to Purchases</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Trucks from the warehouse gate · assign tonnes to open purchase orders · inventory updates on each
              allocation
            </p>
          </div>
          <Link
            href="/warehouse/gatepass"
            target="_blank"
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-black"
            style={{ background: "linear-gradient(135deg,#34d399,#10b981)" }}
          >
            <ClipboardList className="h-4 w-4" />
            Gatepass
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatChip
          label="Trucks waiting"
          value={(pendingTrucks ?? []).filter((t) => t.status !== "ASSIGNED").length}
          color="#f59e0b"
        />
        <StatChip label="Open purchase orders" value={openContracts.length} color="#34d399" />
        <StatChip
          label="Open volume"
          value={summarizeQtyByUnit(openContracts.map((c) => ({ qty: c.openQtyMt, unit: c.quantityUnit })))}
          color="#60a5fa"
        />
      </div>

      <ManualTruckAllocation
        mode="INBOUND"
        trucks={pendingTrucks ?? []}
        contracts={openContracts}
        detailBasePath="/execution/purchase-delivered"
        accent="#34d399"
        accentRgb="#34d399"
        isAssigning={assignMutation.isPending}
        error={assignError}
        successMessage={assignSuccess}
        onClearError={() => setAssignError(null)}
        onAssign={(truckId, tradeRef, weightKg) => {
          assignMutation.mutate({ truckId, tradeRef, overrideWeightKg: weightKg });
        }}
      />

      <p className="text-center text-xs text-zinc-600">
        Allocated receipts update{" "}
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
