"use client";

import {
  allocationSummaryLabel,
  allocationsSumMatchesContract,
  contractHasWarehouseAllocation,
  warehouseShareOfOrder,
  type WarehouseAllocationLine,
} from "@/lib/warehouse-allocation";
import { formatQtyWithUnit } from "@/lib/formatters/numbers";
import { openQtyEpsilon } from "@/lib/unit-conversion";
import { invalidateTradeFlowCaches } from "@/lib/invalidate-caches";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { Lock, Plus, Split, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type ProgressLine = {
  warehouseName: string;
  qtyMt: number;
  fulfilledQtyMt: number;
  openQtyMt: number;
};

type ContractRow = {
  tradeRef: string;
  contractualQtyMt: number;
  receivedQtyMt?: number;
  openQtyMt?: number;
  quantityUnit: string;
  contractStatus?: string;
  allocatedWarehouse?: string | null;
  warehouseAllocations?: WarehouseAllocationLine[] | null;
  warehouseAllocationProgress?: ProgressLine[];
  traderWarehouseHint?: string | null;
  traderWarehouseSelections?: string[];
};

type Props = {
  contract: ContractRow;
  warehouses: { id: string; name: string }[];
  editable: boolean;
  compact?: boolean;
  /** Open the split editor immediately (e.g. on locked contract edit page). */
  defaultOpen?: boolean;
  /** Full-width panel layout for contract edit pages. */
  panel?: boolean;
  /** Execution staff can submit split changes for head approval. */
  canRequestApproval?: boolean;
};

type DraftLine = {
  id: string;
  warehouseName: string;
  openQtyMt: string;
  lockedFulfilled: number;
};

function newDraftLine(warehouseName = ""): DraftLine {
  return { id: crypto.randomUUID(), warehouseName, openQtyMt: "", lockedFulfilled: 0 };
}

function TraderWarehousePicks({ names }: { names: string[] }) {
  if (!names.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] text-subtle">Trader:</span>
      {names.map((n) => (
        <span
          key={n}
          className="rounded border border-accent-secondary/30 bg-accent-secondary/10 px-1.5 py-0.5 text-[10px] text-accent-secondary"
        >
          {n}
        </span>
      ))}
    </div>
  );
}

function WarehouseProgressTable({
  contract,
  progress,
}: {
  contract: ContractRow;
  progress: ProgressLine[];
}) {
  const unit = contract.quantityUnit;
  const fulfilledTotal = contract.receivedQtyMt ?? progress.reduce((s, p) => s + p.fulfilledQtyMt, 0);
  const fulfilledPct =
    contract.contractualQtyMt > 0 ? (fulfilledTotal / contract.contractualQtyMt) * 100 : 0;

  return (
    <div className="space-y-1">
      <div className="text-[10px] text-subtle">
        Order {formatQtyWithUnit(contract.contractualQtyMt, unit, 2)} · Fulfilled{" "}
        {formatQtyWithUnit(fulfilledTotal, unit, 2)} ({fulfilledPct.toFixed(0)}%) · Remaining{" "}
        {formatQtyWithUnit(contract.openQtyMt ?? 0, unit, 2)}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-left text-subtle">
              <th className="pr-2 font-medium">Warehouse</th>
              <th className="pr-2 font-medium tabular-nums">Allocated</th>
              <th className="pr-2 font-medium tabular-nums">Done</th>
              <th className="pr-2 font-medium tabular-nums">Open</th>
              <th className="font-medium tabular-nums">% of order</th>
            </tr>
          </thead>
          <tbody>
            {progress.map((p) => (
              <tr key={p.warehouseName} className="text-muted-foreground">
                <td className="pr-2">{p.warehouseName}</td>
                <td className="pr-2 tabular-nums">{formatQtyWithUnit(p.qtyMt, unit, 2)}</td>
                <td className="pr-2 tabular-nums text-success">
                  {formatQtyWithUnit(p.fulfilledQtyMt, unit, 2)}
                </td>
                <td className="pr-2 tabular-nums">{formatQtyWithUnit(p.openQtyMt, unit, 2)}</td>
                <td className="tabular-nums">{warehouseShareOfOrder(p.qtyMt, contract.contractualQtyMt).toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function WarehouseSplitAllocation({
  contract,
  warehouses,
  editable,
  compact,
  defaultOpen = false,
  panel = false,
  canRequestApproval = false,
}: Props) {
  const utils = trpc.useUtils();
  const canEdit = editable || canRequestApproval;
  const [open, setOpen] = useState(defaultOpen || panel);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [requestComment, setRequestComment] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([newDraftLine()]);

  const allocated = contractHasWarehouseAllocation(contract);
  const progress = contract.warehouseAllocationProgress ?? [];
  const isFulfilled = contract.contractStatus === "Close";
  const unit = contract.quantityUnit;
  const remainingQty = contract.openQtyMt ?? 0;
  const hasPartialFulfillment = (contract.receivedQtyMt ?? 0) > openQtyEpsilon(unit);

  const allocateSingle = trpc.execution.allocateWarehouse.useMutation({
    onSuccess: () => {
      invalidateTradeFlowCaches(utils, contract.tradeRef);
    },
    onError: (e) => setError(e.message),
  });

  const allocateSplit = trpc.execution.allocateWarehouseSplit.useMutation({
    onSuccess: () => {
      if (!panel) setOpen(false);
      setError(null);
      setSaved(true);
      invalidateTradeFlowCaches(utils, contract.tradeRef);
    },
    onError: (e) => setError(e.message),
  });

  const submitRequest = trpc.team.submitChangeRequest.useMutation({
    onSuccess: () => {
      setError(null);
      setSaved(true);
      setRequestComment("");
      invalidateTradeFlowCaches(utils, contract.tradeRef);
    },
    onError: (e) => setError(e.message),
  });

  const isPending = allocateSingle.isPending || allocateSplit.isPending;

  useEffect(() => {
    if (!open && !panel) return;
    if (progress.length) {
      setLines(
        progress.map((p) => ({
          id: crypto.randomUUID(),
          warehouseName: p.warehouseName,
          openQtyMt: p.openQtyMt > 0 ? String(Number(p.openQtyMt.toFixed(4))) : "",
          lockedFulfilled: p.fulfilledQtyMt,
        })),
      );
    } else if (contract.traderWarehouseSelections?.length) {
      setLines(contract.traderWarehouseSelections.map((name) => newDraftLine(name)));
    } else if (hasPartialFulfillment) {
      setLines([newDraftLine()]);
    } else {
      setLines([newDraftLine(), newDraftLine()]);
    }
    setError(null);
    setSaved(false);
  }, [open, panel, contract.tradeRef, contract.traderWarehouseSelections, progress, hasPartialFulfillment]);

  const draftOpenSum = useMemo(
    () =>
      lines.reduce((s, l) => {
        const n = parseFloat(l.openQtyMt);
        return s + (Number.isFinite(n) ? n : 0);
      }, 0),
    [lines],
  );

  const targetRemaining = hasPartialFulfillment ? remainingQty : contract.contractualQtyMt;
  const sumOk = allocationsSumMatchesContract(draftOpenSum, targetRemaining, unit);

  function buildAllocations() {
    return lines
      .filter((l) => l.warehouseName.trim())
      .map((l) => ({
        warehouseName: l.warehouseName.trim(),
        openQtyMt: l.openQtyMt.trim() === "" ? 0 : parseFloat(l.openQtyMt),
      }))
      .filter((l) => Number.isFinite(l.openQtyMt) && l.openQtyMt >= 0);
  }

  function saveSplit() {
    setError(null);
    setSaved(false);
    if (!sumOk) {
      setError(`Split must total ${formatQtyWithUnit(targetRemaining, unit, 2)}`);
      return;
    }
    allocateSplit.mutate({ tradeRef: contract.tradeRef, allocations: buildAllocations() });
  }

  function requestSplitApproval() {
    setError(null);
    setSaved(false);
    if (!requestComment.trim()) {
      setError("Add a comment for the head of execution");
      return;
    }
    if (!sumOk) {
      setError(`Split must total ${formatQtyWithUnit(targetRemaining, unit, 2)}`);
      return;
    }
    submitRequest.mutate({
      department: "EXECUTION",
      entityType: "LOCKED_CONTRACT_WAREHOUSE",
      entityRef: contract.tradeRef,
      entityLabel: `${contract.tradeRef} warehouse split (remaining qty)`,
      action: "EDIT",
      comment: requestComment.trim(),
      payload: { warehouseSplit: buildAllocations() },
    });
  }

  if (!canEdit && !allocated) {
    return contract.traderWarehouseSelections?.length || contract.traderWarehouseHint ? (
      <div className="space-y-1">
        {contract.traderWarehouseSelections?.length ? (
          <TraderWarehousePicks names={contract.traderWarehouseSelections} />
        ) : (
          <span className="text-[11px] text-subtle">Hint: {contract.traderWarehouseHint}</span>
        )}
      </div>
    ) : (
      <span className="text-[11px] text-destructive">Not allocated</span>
    );
  }

  if (!canEdit && allocated) {
    return (
      <div className="space-y-1">
        <span className="text-muted-foreground">{allocationSummaryLabel(contract, unit)}</span>
        {progress.length > 0 && <WarehouseProgressTable contract={contract} progress={progress} />}
      </div>
    );
  }

  if (compact && !allocated && !hasPartialFulfillment && !contract.traderWarehouseSelections?.length) {
    return (
      <select
        value=""
        disabled={isPending}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          allocateSingle.mutate({ tradeRef: contract.tradeRef, warehouseName: v });
        }}
        className="kastros-select kastros-select-sm max-w-[160px] rounded-lg border-destructive/30 bg-[color-mix(in_srgb,var(--destructive)_8%,transparent)] text-[11px]"
      >
        <option value="">Select warehouse…</option>
        {warehouses.map((w) => (
          <option key={w.id} value={w.name}>
            {w.name}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="space-y-1">
      {allocated || progress.length > 0 ? (
        <div className="space-y-1">
          {allocated && (
            <span
              className={cn(
                "text-[11px] font-medium",
                progress.length > 1 ? "text-accent-secondary" : "text-muted-foreground",
              )}
            >
              {allocationSummaryLabel(contract, unit)}
            </span>
          )}
          {progress.length > 0 && <WarehouseProgressTable contract={contract} progress={progress} />}
        </div>
      ) : (
        <span className="text-[11px] font-medium text-destructive">Not allocated</span>
      )}

      {contract.traderWarehouseSelections?.length && !allocated && !progress.length && (
        <TraderWarehousePicks names={contract.traderWarehouseSelections} />
      )}

      {!isFulfilled && canEdit && !panel && (
        <button
          type="button"
          disabled={isPending}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-[10px] font-medium text-accent-secondary hover:underline"
        >
          <Split className="h-3 w-3" />
          {open
            ? "Close split editor"
            : hasPartialFulfillment
              ? `Split remaining ${formatQtyWithUnit(remainingQty, unit, 2)}`
              : allocated
                ? "Edit split"
                : contract.traderWarehouseSelections?.length
                  ? "Set quantities per warehouse"
                  : "Split across warehouses"}
        </button>
      )}

      {isFulfilled && (allocated || progress.length > 0) && (
        <span className="block text-[10px] text-subtle">Locked — trade fulfilled</span>
      )}

      {contract.traderWarehouseHint &&
        !contract.traderWarehouseSelections?.length &&
        !allocated &&
        !progress.length && (
        <span className="block text-[10px] text-subtle">Hint: {contract.traderWarehouseHint}</span>
      )}

      {(open || panel) && canEdit && (
        <div
          className={cn(
            "space-y-3",
            panel
              ? "mt-3 rounded-lg border border-border bg-card p-4"
              : "mt-2 min-w-[260px] space-y-2 rounded-lg border border-border bg-card p-2 shadow-sm",
          )}
        >
          {hasPartialFulfillment ? (
            <p className={cn(panel ? "text-xs" : "text-[10px]", "text-subtle")}>
              Assign the{" "}
              <span className="font-semibold text-foreground">
                remaining {formatQtyWithUnit(remainingQty, unit, 2)}
              </span>{" "}
              across warehouses. Use <strong className="text-foreground">Add warehouse</strong> to pick
              another location. Quantities already received/dispatched are locked and cannot be reduced.
            </p>
          ) : (
            <p className={cn(panel ? "text-xs" : "text-[10px]", "text-subtle")}>
              Split the full order{" "}
              <span className="font-semibold text-foreground">
                {formatQtyWithUnit(contract.contractualQtyMt, unit, 2)}
              </span>{" "}
              across warehouses.
            </p>
          )}
          {lines.map((line, idx) => {
            const isLocked = line.lockedFulfilled > openQtyEpsilon(unit);
            return (
              <div
                key={line.id}
                className={cn(
                  "space-y-1 rounded border border-border/60",
                  panel ? "p-3" : "p-1.5",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={line.warehouseName}
                    disabled={isPending || isLocked}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l) =>
                          l.id === line.id ? { ...l, warehouseName: e.target.value } : l,
                        ),
                      )
                    }
                    className={cn(
                      "kastros-select min-w-[160px] flex-1",
                      panel ? "text-sm" : "kastros-select-sm rounded text-[10px]",
                    )}
                  >
                    <option value="">Select warehouse…</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.name}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    placeholder="Remaining qty"
                    value={line.openQtyMt}
                    disabled={isPending}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l) => (l.id === line.id ? { ...l, openQtyMt: e.target.value } : l)),
                      )
                    }
                    className={cn("kastros-input tabular-nums", panel ? "w-32 text-sm" : "w-20 rounded px-1.5 py-1 text-[10px]")}
                  />
                  <span className={cn(panel ? "text-sm" : "text-[10px]", "text-subtle")}>{unit}</span>
                  {lines.length > 1 && !isLocked && (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => setLines((prev) => prev.filter((l) => l.id !== line.id))}
                      className="rounded p-1 text-destructive hover:bg-destructive/10"
                      aria-label={`Remove warehouse line ${idx + 1}`}
                    >
                      <Trash2 className={panel ? "h-4 w-4" : "h-3 w-3"} />
                    </button>
                  )}
                </div>
                {isLocked && (
                  <div className={cn("flex items-center gap-1 text-success", panel ? "text-xs" : "text-[10px]")}>
                    <Lock className={panel ? "h-3.5 w-3.5" : "h-3 w-3"} />
                    {formatQtyWithUnit(line.lockedFulfilled, unit, 2)} already done at this warehouse — open
                    qty only
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => setLines((prev) => [...prev, newDraftLine()])}
              className={cn(
                "inline-flex items-center gap-1 font-medium text-accent-secondary hover:underline",
                panel ? "text-sm" : "text-[10px]",
              )}
            >
              <Plus className={panel ? "h-4 w-4" : "h-3 w-3"} />
              Add warehouse
            </button>
            <span
              className={cn(
                "tabular-nums",
                panel ? "text-sm" : "text-[10px]",
                sumOk ? "text-success" : "text-destructive",
              )}
            >
              Remaining split: {draftOpenSum.toFixed(3)} / {targetRemaining.toFixed(3)} {unit}
            </span>
          </div>
          {error && <p className={cn(panel ? "text-sm" : "text-[10px]", "text-destructive")}>{error}</p>}
          {saved && !error && (
            <p className={cn(panel ? "text-sm" : "text-[10px]", "text-success")}>
              {editable ? "Warehouse split saved." : "Split submitted for head approval."}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {editable ? (
              <button
                type="button"
                disabled={isPending || !sumOk}
                onClick={saveSplit}
                className={cn("kastros-btn-primary disabled:opacity-50", panel ? "px-4 py-2 text-sm" : "px-2 py-1 text-[10px]")}
              >
                {allocateSplit.isPending ? "Saving…" : "Save split"}
              </button>
            ) : canRequestApproval ? (
              <>
                <input
                  value={requestComment}
                  onChange={(e) => setRequestComment(e.target.value)}
                  placeholder="Comment for head of execution…"
                  className="kastros-input min-w-[200px] flex-1 text-sm"
                />
                <button
                  type="button"
                  disabled={submitRequest.isPending || !sumOk}
                  onClick={requestSplitApproval}
                  className="kastros-btn-primary px-4 py-2 text-sm disabled:opacity-50"
                >
                  {submitRequest.isPending ? "Submitting…" : "Submit for approval"}
                </button>
              </>
            ) : null}
            {!panel && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => setOpen(false)}
                className="kastros-btn-ghost px-2 py-1 text-[10px]"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function warehouseOpenQtyAt(contract: ContractRow, warehouseName: string): number {
  const progress = contract.warehouseAllocationProgress;
  if (progress?.length) {
    const line = progress.find(
      (p) => p.warehouseName.trim().toLowerCase() === warehouseName.trim().toLowerCase(),
    );
    if (line) return line.openQtyMt;
  }
  return contract.openQtyMt ?? 0;
}
