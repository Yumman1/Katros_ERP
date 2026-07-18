"use client";

import { DeskPage, DeskScroll } from "@/components/layout/desk-page";
import { CommodityFilterBar } from "@/components/execution/commodity-filter-bar";
import { PositionLegend, PositionLedgerTable } from "@/components/position/position-ledger-table";
import { collectCommodityOptions } from "@/lib/execution-commodity-filter";
import { trpc } from "@/lib/trpc/client";
import { useMemo, useState } from "react";

export default function ExecutionPositionsPage() {
  const [commodityFilter, setCommodityFilter] = useState("ALL");
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const { data: rows, isLoading } = trpc.execution.positionLedger.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const setAdj = trpc.execution.setPositionAdjustment.useMutation({
    onMutate: ({ commodityCode }) => setSavingCode(commodityCode),
    onSettled: () => {
      setSavingCode(null);
      void utils.execution.positionLedger.invalidate();
    },
  });

  const commodityOptions = useMemo(
    () =>
      collectCommodityOptions(
        (rows ?? []).map((r) => ({ commodityCode: r.commodityCode, commodityName: r.commodityName })),
      ),
    [rows],
  );

  const filtered = useMemo(() => {
    const list = rows ?? [];
    if (commodityFilter === "ALL") return list;
    return list.filter((r) => r.commodityCode === commodityFilter);
  }, [rows, commodityFilter]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, r) => {
        acc.paperNet += r.paperNet;
        acc.physicalNet += r.physicalNet;
        acc.variance += r.variance;
        return acc;
      },
      { paperNet: 0, physicalNet: 0, variance: 0 },
    );
  }, [filtered]);

  return (
    <DeskPage>
      <DeskScroll className="space-y-5 pb-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Position ledger</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Paper vs physical balance by commodity. Execution head can apply manual stock corrections.
        </p>
      </div>

      {commodityOptions.length > 0 && (
        <CommodityFilterBar commodities={commodityOptions} value={commodityFilter} onChange={setCommodityFilter} />
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Paper net (MT)" value={totals.paperNet.toFixed(2)} />
        <Stat label="Physical net (MT)" value={totals.physicalNet.toFixed(2)} />
        <Stat label="Variance (MT)" value={totals.variance.toFixed(2)} warn={Math.abs(totals.variance) > 0.5} />
      </div>

      <PositionLegend />

      {isLoading ? (
        <div className="animate-pulse text-muted-foreground">Loading position ledger…</div>
      ) : (
        <PositionLedgerTable
          rows={rows ?? []}
          commodityFilter={commodityFilter}
          editable
          savingCode={savingCode}
          onSaveAdjustment={(code, delta) => setAdj.mutate({ commodityCode: code, deltaMt: delta })}
        />
      )}

      {setAdj.error && (
        <p className="text-sm text-destructive">{setAdj.error.message}</p>
      )}
      </DeskScroll>
    </DeskPage>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${warn ? "text-warning" : "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}
