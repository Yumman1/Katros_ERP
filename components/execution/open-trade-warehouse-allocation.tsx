"use client";

import { SearchableSelect } from "@/components/ui/searchable-select";

import { invalidateTradeFlowCaches } from "@/lib/invalidate-caches";
import { formatQtyWithUnit } from "@/lib/formatters/numbers";
import {
  allocationSummaryLabel,
  allocationsSumMatchesContract,
  parseExecutionWarehouseSplit,
  parseTraderWarehouseSelections,
  type WarehouseOpenAllocationLine,
} from "@/lib/warehouse-allocation";
import { trpc } from "@/lib/trpc/client";
import { useTeam } from "@/lib/use-team";
import { canActOnDepartment } from "@/lib/departments";
import { cn } from "@/lib/utils";
import { CheckCircle2, Clock, Plus, Split, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type SplitLine = { id: string; warehouseName: string; openQtyMt: string };

function newSplitLine(name = ""): SplitLine {
  return { id: crypto.randomUUID(), warehouseName: name, openQtyMt: "" };
}

type Props = {
  tradeRef: string;
  contractualQtyMt: number;
  quantityUnit: string;
  tradeParams?: Record<string, string | number | null> | null;
  warehouseSplitApproved?: boolean;
  pendingWarehouseApproval?: boolean;
  warehouseSplitApprovedBy?: string | null;
};

export function OpenTradeWarehouseAllocation({
  tradeRef,
  contractualQtyMt,
  quantityUnit,
  tradeParams,
  warehouseSplitApproved,
  pendingWarehouseApproval,
  warehouseSplitApprovedBy,
}: Props) {
  const utils = trpc.useUtils();
  const { role, isHead } = useTeam();
  const isExecutionHead = role != null && canActOnDepartment(role, isHead, "EXECUTION");

  const { data: warehouses, isLoading: warehousesLoading } = trpc.execution.companyWarehouses.useQuery();

  const traderPicks = parseTraderWarehouseSelections(tradeParams ?? null);
  const savedSplit = parseExecutionWarehouseSplit(tradeParams ?? null);

  const needsAllocation = !warehouseSplitApproved;
  const [open, setOpen] = useState(needsAllocation);
  const [lines, setLines] = useState<SplitLine[]>([newSplitLine(), newSplitLine()]);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const warehouseOptions = useMemo(() => {
    const byKey = new Map<string, { id: string; name: string }>();
    for (const w of warehouses ?? []) {
      byKey.set(w.name.trim().toLowerCase(), w);
    }
    for (const name of [
      ...traderPicks,
      ...savedSplit.map((s) => s.warehouseName),
      ...lines.map((l) => l.warehouseName),
    ]) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (!byKey.has(key)) {
        byKey.set(key, { id: key, name: trimmed });
      }
    }
    return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [warehouses, traderPicks, savedSplit, lines]);

  useEffect(() => {
    if (needsAllocation) setOpen(true);
  }, [tradeRef, needsAllocation]);

  useEffect(() => {
    if (savedSplit.length) {
      setLines(
        savedSplit.map((s) => ({
          id: crypto.randomUUID(),
          warehouseName: s.warehouseName,
          openQtyMt: String(s.openQtyMt),
        })),
      );
    } else if (traderPicks.length) {
      setLines(traderPicks.map((n) => newSplitLine(n)));
    } else {
      setLines([newSplitLine(), newSplitLine()]);
    }
    setSaved(false);
  }, [tradeRef, tradeParams, savedSplit.length, traderPicks.join("|")]);

  const draftSum = useMemo(
    () =>
      lines.reduce((s, l) => {
        const n = parseFloat(l.openQtyMt);
        return s + (Number.isFinite(n) ? n : 0);
      }, 0),
    [lines],
  );

  const sumOk = allocationsSumMatchesContract(draftSum, contractualQtyMt, quantityUnit);

  function buildAllocations(): WarehouseOpenAllocationLine[] {
    return lines
      .filter((l) => l.warehouseName.trim())
      .map((l) => ({
        warehouseName: l.warehouseName.trim(),
        openQtyMt: parseFloat(l.openQtyMt),
      }))
      .filter((l) => Number.isFinite(l.openQtyMt) && l.openQtyMt > 0);
  }

  const approve = trpc.execution.approveOpenTradeWarehouseSplit.useMutation({
    onSuccess: () => {
      setSaved(true);
      setError(null);
      setOpen(false);
      invalidateTradeFlowCaches(utils, tradeRef);
    },
    onError: (e) => setError(e.message),
  });

  const submitRequest = trpc.team.submitChangeRequest.useMutation({
    onSuccess: () => {
      setSaved(true);
      setError(null);
      setComment("");
      setOpen(false);
      invalidateTradeFlowCaches(utils, tradeRef);
    },
    onError: (e) => setError(e.message),
  });

  function saveHead() {
    setError(null);
    if (!sumOk) {
      setError(`Split must total ${formatQtyWithUnit(contractualQtyMt, quantityUnit, 2)}`);
      return;
    }
    approve.mutate({ tradeRef, allocations: buildAllocations() });
  }

  function requestStaff() {
    setError(null);
    if (!comment.trim()) {
      setError("Add a comment for the head of execution");
      return;
    }
    if (!sumOk) {
      setError(`Split must total ${formatQtyWithUnit(contractualQtyMt, quantityUnit, 2)}`);
      return;
    }
    submitRequest.mutate({
      department: "EXECUTION",
      entityType: "OPEN_TRADE_WAREHOUSE",
      entityRef: tradeRef,
      entityLabel: `${tradeRef} warehouse allocation`,
      action: "EDIT",
      comment: comment.trim(),
      payload: { warehouseSplit: buildAllocations() },
    });
  }

  const contractLike = {
    contractualQtyMt,
    quantityUnit,
    warehouseAllocations: savedSplit.map((s) => ({ warehouseName: s.warehouseName, qtyMt: s.openQtyMt })),
    allocatedWarehouse: savedSplit.length === 1 ? savedSplit[0]!.warehouseName : null,
  };

  return (
    <section className="rounded-xl border border-kastros-border bg-kastros-card p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Split className="h-4 w-4 text-accent-secondary" />
          <h2 className="text-sm font-semibold text-foreground">Warehouse allocation</h2>
        </div>
        {warehouseSplitApproved ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-0.5 text-[10px] font-bold uppercase text-success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Approved{warehouseSplitApprovedBy ? ` · ${warehouseSplitApprovedBy}` : ""}
          </span>
        ) : pendingWarehouseApproval ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-0.5 text-[10px] font-bold uppercase text-warning">
            <Clock className="h-3.5 w-3.5" />
            Awaiting head approval
          </span>
        ) : (
          <span className="rounded-full bg-destructive/15 px-2.5 py-0.5 text-[10px] font-bold uppercase text-destructive">
            Required before lock
          </span>
        )}
      </div>

      <p className="text-xs text-subtle">
        Split the full order{" "}
        <strong className="text-foreground">
          {formatQtyWithUnit(contractualQtyMt, quantityUnit, 2)}
        </strong>{" "}
        across warehouses. Trader warehouse names are hints only — quantities must be allocated and approved
        here before the trade can be locked.
      </p>

      {traderPicks.length > 0 && (
        <p className="text-xs text-subtle">
          Trader picks:{" "}
          {traderPicks.map((n) => (
            <span
              key={n}
              className="mr-1 rounded border border-accent-secondary/30 bg-accent-secondary/10 px-1.5 py-0.5 text-[10px] text-accent-secondary"
            >
              {n}
            </span>
          ))}
        </p>
      )}

      {savedSplit.length > 0 && (
        <div className="text-sm text-muted-foreground">
          Current split: {allocationSummaryLabel(contractLike, quantityUnit)}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-xs font-medium text-accent-secondary hover:underline"
      >
        <Split className="h-3.5 w-3.5" />
        {open ? "Close allocation editor" : savedSplit.length ? "Edit warehouse split" : "Allocate quantities"}
      </button>

      {open && (
        <div className="space-y-3 rounded-lg border border-border bg-card p-3">
          {lines.map((line, idx) => (
            <div key={line.id} className="flex flex-wrap items-center gap-2">
              <SearchableSelect
                value={line.warehouseName}
                onChange={(e) =>
                  setLines((rows) =>
                    rows.map((r, i) => (i === idx ? { ...r, warehouseName: e.target.value } : r)),
                  )
                }
                className="kastros-select min-w-[160px] flex-1"
              >
                <option value="">
                  {warehousesLoading ? "Loading warehouses…" : "Select warehouse…"}
                </option>
                {warehouseOptions.map((w) => (
                  <option key={w.id} value={w.name}>
                    {w.name}
                  </option>
                ))}
              </SearchableSelect>
              <input
                type="number"
                min={0}
                step="any"
                placeholder="Qty"
                value={line.openQtyMt}
                onChange={(e) =>
                  setLines((rows) =>
                    rows.map((r, i) => (i === idx ? { ...r, openQtyMt: e.target.value } : r)),
                  )
                }
                className="kastros-input w-28"
              />
              <span className="text-xs text-subtle">{quantityUnit}</span>
              {lines.length > 1 && (
                <button
                  type="button"
                  onClick={() => setLines((rows) => rows.filter((_, i) => i !== idx))}
                  className="rounded p-1 text-subtle hover:text-destructive"
                  aria-label="Remove line"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}

          {!warehousesLoading && warehouseOptions.length === 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              No warehouses found. Register company warehouses under Execution → Warehouses setup.
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setLines((rows) => [...rows, newSplitLine()])}
              className="inline-flex items-center gap-1 text-xs text-accent-secondary hover:underline"
            >
              <Plus className="h-3.5 w-3.5" /> Add warehouse
            </button>
            <span className={cn("text-xs tabular-nums", sumOk ? "text-success" : "text-destructive")}>
              Split total: {draftSum.toFixed(3)} / {contractualQtyMt.toFixed(3)} {quantityUnit}
            </span>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
          {saved && !error && (
            <p className="text-xs text-success">
              {isExecutionHead
                ? "Warehouse allocation saved and approved."
                : "Allocation submitted for head approval."}
            </p>
          )}

          {isExecutionHead ? (
            <button
              type="button"
              disabled={approve.isPending || !sumOk}
              onClick={saveHead}
              className="kastros-btn-primary text-xs disabled:opacity-50"
            >
              {approve.isPending ? "Saving…" : "Save & approve allocation"}
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Comment for head of execution…"
                className="kastros-input min-w-[200px] flex-1 text-xs"
              />
              <button
                type="button"
                disabled={submitRequest.isPending || !sumOk}
                onClick={requestStaff}
                className="kastros-btn-primary text-xs disabled:opacity-50"
              >
                {submitRequest.isPending ? "Submitting…" : "Submit for head approval"}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
