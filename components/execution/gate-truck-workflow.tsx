"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, Pencil } from "lucide-react";
import { formatCurrency } from "@/lib/formatters/numbers";
import { invalidateGateOpsCaches } from "@/lib/invalidate-caches";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

/** Minimal truck shape the workflow cell needs (subset of the runtime PendingTruck). */
export type WorkflowTruck = {
  id: string;
  movementType: "INBOUND" | "OUTBOUND";
  status: string;
  counterpartyName: string;
  commodityCode?: string | null;
  warehouseName: string;
  remainingKg: number;
  assignedTradeRef?: string | null;
  gateInvoiceNo?: string | null;
  gateInvoiceAmount?: number | null;
  gateInvoiceExpectedPkr?: number | null;
  gateInvoiceStage?: string | null;
};

/** Minimal contract shape for the inline assign control. */
export type WorkflowContract = {
  tradeRef: string;
  counterpartyName: string;
  commodityCode: string;
  commodityName: string;
  executionProfile: string;
  contractStatus?: string;
  openQtyMt: number;
  quantityUnit: string;
};

function normCp(s: string) {
  return s.trim().toLowerCase();
}

function counterpartyMatches(truck: WorkflowTruck, contract: WorkflowContract): boolean {
  const cp = normCp(contract.counterpartyName);
  const n = normCp(truck.counterpartyName);
  return cp === n || cp.includes(n) || n.includes(cp);
}

function commodityMatches(truck: WorkflowTruck, contract: WorkflowContract): boolean {
  if (!truck.commodityCode?.trim()) return true;
  return contract.commodityCode === truck.commodityCode;
}

const chipBase =
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold";

function StepDoneChip({ step, label, detail }: { step: number; label: string; detail?: string }) {
  return (
    <span className={cn(chipBase, "border-success/40 bg-success/10 text-success")}>
      <Check className="h-3 w-3" />
      {step} {label}
      {detail && <span className="font-mono font-normal text-success/80">{detail}</span>}
    </span>
  );
}

function StepPendingBadge({ step, label }: { step: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-subtle">
      <span className="flex h-4 w-4 items-center justify-center rounded-full border border-kastros-border text-[9px] text-muted-foreground">
        {step}
      </span>
      {label}
    </span>
  );
}

/**
 * Two-step guided workflow for a gatepass truck: 1) assign to a trade,
 * 2) enter the physical gate invoice (inbound only). The row leaves the
 * incomplete list once both steps are done.
 */
export function GateTruckWorkflow({
  truck,
  contracts,
}: {
  truck: WorkflowTruck;
  contracts: WorkflowContract[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <TradeStep truck={truck} contracts={contracts} />
      {truck.movementType === "INBOUND" && <InvoiceStep truck={truck} />}
    </div>
  );
}

// ─── Step 1 · Trade assignment ────────────────────────────────────────────────

function TradeStep({ truck, contracts }: { truck: WorkflowTruck; contracts: WorkflowContract[] }) {
  const utils = trpc.useUtils();
  const [tradeRef, setTradeRef] = useState("");

  const assign = trpc.execution.assignTruckToTrade.useMutation({
    onSuccess: () => invalidateGateOpsCaches(utils),
  });

  const eligible = useMemo(() => {
    const profiles =
      truck.movementType === "INBOUND"
        ? ["PURCHASE_DELIVERED", "PURCHASE_SPOT"]
        : ["SALE_EX_WAREHOUSE"];
    return contracts
      .filter((c) => (c.contractStatus ?? "Open") === "Open" && c.openQtyMt > 0.001)
      .filter((c) => profiles.includes(c.executionProfile))
      .filter((c) => counterpartyMatches(truck, c) && commodityMatches(truck, c))
      .sort((a, b) => a.tradeRef.localeCompare(b.tradeRef));
  }, [contracts, truck]);

  if (truck.status === "ASSIGNED" && truck.assignedTradeRef) {
    return <StepDoneChip step={1} label="Trade" detail={truck.assignedTradeRef} />;
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <StepPendingBadge step={1} label="Trade" />
        {eligible.length === 0 ? (
          <span className="text-[11px] text-subtle">No matching open trade</span>
        ) : (
          <>
            <select
              value={tradeRef}
              onChange={(e) => setTradeRef(e.target.value)}
              className="kastros-input kastros-input-sm max-w-[190px] py-1 text-[11px]"
              aria-label="Trade to assign"
            >
              <option value="">Select trade…</option>
              {eligible.map((c) => (
                <option key={c.tradeRef} value={c.tradeRef}>
                  {c.tradeRef} · {c.commodityCode} · open {c.openQtyMt.toFixed(1)} {c.quantityUnit}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!tradeRef || assign.isPending}
              onClick={() => assign.mutate({ truckId: truck.id, tradeRef })}
              className="kastros-btn-primary px-2.5 py-1 text-[11px] disabled:opacity-50"
            >
              {assign.isPending ? "Assigning…" : "Assign"}
            </button>
          </>
        )}
      </div>
      {truck.status === "PARTIAL" && truck.assignedTradeRef && (
        <span className="text-[10px] text-info">
          Partially assigned to {truck.assignedTradeRef} — weight left on truck
        </span>
      )}
      {assign.error && (
        <span className="flex items-center gap-1 text-[10px] text-destructive">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {assign.error.message}
        </span>
      )}
    </div>
  );
}

// ─── Step 2 · Gate invoice ────────────────────────────────────────────────────

function InvoiceStep({ truck }: { truck: WorkflowTruck }) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [amount, setAmount] = useState("");

  const save = trpc.execution.setManualGateInvoice.useMutation({
    onSuccess: () => {
      setEditing(false);
      invalidateGateOpsCaches(utils);
    },
  });

  const hasInvoice = Boolean(truck.gateInvoiceNo);
  const wrongInvoicing = hasInvoice && truck.gateInvoiceStage === "WRONG_INVOICING";
  const expected = truck.gateInvoiceExpectedPkr;

  function openEditor() {
    setInvoiceNo(truck.gateInvoiceNo ?? "");
    setAmount(truck.gateInvoiceAmount != null ? String(truck.gateInvoiceAmount) : "");
    save.reset();
    setEditing(true);
  }

  if (hasInvoice && !editing) {
    if (wrongInvoicing) {
      return (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn(chipBase, "border-destructive/40 bg-destructive/10 text-destructive")}>
              <AlertTriangle className="h-3 w-3" />
              Wrong invoicing
            </span>
            <button
              type="button"
              onClick={openEditor}
              className="inline-flex items-center gap-1 rounded-md border border-kastros-border bg-white/5 px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-foreground/10"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
          </div>
          <span className="text-[10px] text-subtle">
            Entered {formatCurrency(truck.gateInvoiceAmount ?? 0, "PKR")}
            {expected != null && <> · expected {formatCurrency(expected, "PKR")}</>}
          </span>
        </div>
      );
    }
    return (
      <StepDoneChip
        step={2}
        label="Invoice"
        detail={`${truck.gateInvoiceNo}${
          truck.gateInvoiceAmount != null ? ` · ${formatCurrency(truck.gateInvoiceAmount, "PKR")}` : ""
        }`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <StepPendingBadge step={2} label="Invoice" />
        {expected != null ? (
          <span
            className="rounded-md border border-kastros-border bg-black/20 px-2 py-1 font-mono text-[11px] text-accent-secondary"
            title="Expected amount — net warehouse weight × contract rate"
          >
            Exp. {formatCurrency(expected, "PKR")}
          </span>
        ) : (
          <span className="text-[10px] text-subtle">Expected after trade assignment</span>
        )}
        <input
          value={invoiceNo}
          onChange={(e) => setInvoiceNo(e.target.value)}
          placeholder="Invoice no."
          className="kastros-input kastros-input-sm w-28 py-1 text-[11px]"
          aria-label="Invoice number"
        />
        <input
          type="number"
          min={0}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount PKR"
          className="kastros-input kastros-input-sm w-28 py-1 text-[11px]"
          aria-label="Invoice amount (PKR)"
        />
        <button
          type="button"
          disabled={save.isPending || invoiceNo.trim() === "" || !(Number(amount) > 0)}
          onClick={() =>
            save.mutate({ truckId: truck.id, invoiceNo: invoiceNo.trim(), amountPkr: Number(amount) })
          }
          className="kastros-btn-primary px-2.5 py-1 text-[11px] disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
        {editing && (
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="kastros-btn-secondary px-2 py-1 text-[11px]"
          >
            Cancel
          </button>
        )}
      </div>
      {save.error && (
        <span className="flex items-center gap-1 text-[10px] text-destructive">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {save.error.message}
        </span>
      )}
    </div>
  );
}
