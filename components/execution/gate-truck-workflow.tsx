"use client";

import Link from "next/link";
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

/** "warn" = completed with a caveat (Check badge, warning colours). */
type StepState = "done" | "active" | "waiting" | "error" | "warn";

function StepPanel({
  step,
  title,
  state,
  headline,
  children,
}: {
  step: number;
  title: string;
  state: StepState;
  /** Short status text shown at the right of the header. */
  headline?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-lg border p-3",
        state === "done" && "border-success/40 bg-success/[0.06]",
        state === "warn" && "border-warning/40 bg-warning/[0.06]",
        state === "error" && "border-destructive/40 bg-destructive/[0.06]",
        state === "active" && "border-kastros-border bg-kastros-bg/60",
        state === "waiting" && "border-dashed border-kastros-border/70 bg-transparent opacity-70",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
            state === "done" && "bg-success text-white",
            state === "warn" && "bg-warning text-white",
            state === "error" && "bg-destructive text-white",
            state === "active" && "border border-kastros-border text-muted-foreground",
            state === "waiting" && "border border-dashed border-kastros-border text-subtle",
          )}
        >
          {state === "done" || state === "warn" ? <Check className="h-3 w-3" /> : step}
        </span>
        <span className="text-[11px] font-bold uppercase tracking-wider text-foreground">
          {title}
        </span>
        {headline && (
          <span
            className={cn(
              "ml-auto truncate text-[11px] font-medium",
              state === "done" && "text-success",
              state === "warn" && "text-warning",
              state === "error" && "text-destructive",
              (state === "active" || state === "waiting") && "text-subtle",
            )}
          >
            {headline}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <span className="flex items-start gap-1 text-[10px] text-destructive">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
      {message}
    </span>
  );
}

/**
 * Two-step guided workflow strip for a gatepass truck: 1) assign to a trade,
 * 2) inbound — enter the physical gate invoice; outbound — collect the buyer's
 * payment (or CEO clearance). The card leaves the incomplete list once both
 * steps are done.
 */
export function GateTruckWorkflow({
  truck,
  contracts,
}: {
  truck: WorkflowTruck;
  contracts: WorkflowContract[];
}) {
  const inbound = truck.movementType === "INBOUND";
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <TradeStep truck={truck} contracts={contracts} />
      {inbound && <InvoiceStep truck={truck} />}
      {!inbound && <PaymentStep truck={truck} />}
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
    return (
      <StepPanel step={1} title="Trade" state="done" headline="Assigned">
        <span className="font-mono text-xs font-semibold text-foreground">
          {truck.assignedTradeRef}
        </span>
      </StepPanel>
    );
  }

  return (
    <StepPanel
      step={1}
      title="Assign trade"
      state="active"
      headline={eligible.length === 0 ? "No matching open trade" : undefined}
    >
      {eligible.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            value={tradeRef}
            onChange={(e) => setTradeRef(e.target.value)}
            className="kastros-input kastros-input-sm min-w-0 flex-1 py-1.5 text-[11px]"
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
            className="kastros-btn-primary shrink-0 px-3 py-1.5 text-[11px] disabled:opacity-50"
          >
            {assign.isPending ? "Assigning…" : "Assign"}
          </button>
        </div>
      )}
      {truck.status === "PARTIAL" && truck.assignedTradeRef && (
        <span className="text-[10px] text-info">
          Partially assigned to {truck.assignedTradeRef} — weight left on truck
        </span>
      )}
      {assign.error && <ErrorLine message={assign.error.message} />}
    </StepPanel>
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

  const tradeAssigned = truck.status === "ASSIGNED" && Boolean(truck.assignedTradeRef);
  const hasInvoice = Boolean(truck.gateInvoiceNo);
  const wrongInvoicing = hasInvoice && truck.gateInvoiceStage === "WRONG_INVOICING";
  const expected = truck.gateInvoiceExpectedPkr;

  function openEditor() {
    setInvoiceNo(truck.gateInvoiceNo ?? "");
    setAmount(truck.gateInvoiceAmount != null ? String(truck.gateInvoiceAmount) : "");
    save.reset();
    setEditing(true);
  }

  // Saved and matching — done.
  if (hasInvoice && !editing && !wrongInvoicing) {
    return (
      <StepPanel step={2} title="Invoice" state="done" headline="Recorded">
        <span className="truncate font-mono text-xs font-semibold text-foreground">
          {truck.gateInvoiceNo}
          {truck.gateInvoiceAmount != null && (
            <span className="text-muted-foreground">
              {" "}
              · {formatCurrency(truck.gateInvoiceAmount, "PKR")}
            </span>
          )}
        </span>
      </StepPanel>
    );
  }

  // Saved but mismatched — flagged, editable.
  if (hasInvoice && !editing && wrongInvoicing) {
    return (
      <StepPanel step={2} title="Invoice" state="error" headline="Wrong invoicing">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[11px] text-muted-foreground">
            Entered{" "}
            <span className="font-mono font-semibold text-destructive">
              {formatCurrency(truck.gateInvoiceAmount ?? 0, "PKR")}
            </span>
            {expected != null && (
              <>
                {" "}
                — expected{" "}
                <span className="font-mono font-semibold text-foreground">
                  {formatCurrency(expected, "PKR")}
                </span>
              </>
            )}
          </span>
          <button
            type="button"
            onClick={openEditor}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-kastros-border px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-foreground/10"
          >
            <Pencil className="h-3 w-3" />
            Fix
          </button>
        </div>
      </StepPanel>
    );
  }

  // Waiting for step 1.
  if (!tradeAssigned && !hasInvoice) {
    return (
      <StepPanel step={2} title="Invoice" state="waiting" headline="After trade assignment">
        <span className="text-[10px] text-subtle">
          The expected amount (net weight × contract rate) appears here once a trade is assigned.
        </span>
      </StepPanel>
    );
  }

  // Entry / edit form.
  return (
    <StepPanel step={2} title="Enter invoice" state="active">
      {expected != null && (
        <div
          className="flex items-baseline justify-between rounded-md border border-kastros-border/70 bg-black/10 px-2.5 py-1.5"
          title="Expected amount — net warehouse weight × contract rate"
        >
          <span className="text-[10px] uppercase tracking-wider text-subtle">Expected</span>
          <span className="font-mono text-xs font-semibold text-accent-secondary">
            {formatCurrency(expected, "PKR")}
          </span>
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          value={invoiceNo}
          onChange={(e) => setInvoiceNo(e.target.value)}
          placeholder="Invoice no."
          className="kastros-input kastros-input-sm w-0 min-w-0 flex-1 py-1.5 text-[11px]"
          aria-label="Invoice number"
        />
        <input
          type="number"
          min={0}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount PKR"
          className="kastros-input kastros-input-sm w-0 min-w-0 flex-1 py-1.5 text-[11px]"
          aria-label="Invoice amount (PKR)"
        />
        <button
          type="button"
          disabled={save.isPending || invoiceNo.trim() === "" || !(Number(amount) > 0)}
          onClick={() =>
            save.mutate({ truckId: truck.id, invoiceNo: invoiceNo.trim(), amountPkr: Number(amount) })
          }
          className="kastros-btn-primary shrink-0 px-3 py-1.5 text-[11px] disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
        {editing && (
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="kastros-btn-secondary shrink-0 px-2.5 py-1.5 text-[11px]"
          >
            Cancel
          </button>
        )}
      </div>
      {save.error && <ErrorLine message={save.error.message} />}
    </StepPanel>
  );
}

// ─── Step 2 · Sale payment (outbound) ────────────────────────────────────────

const fmtPkr = (n: number) =>
  `${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(n)} PKR`;

function AmountLine({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className={cn("text-[10px] uppercase tracking-wider", bold ? "text-muted-foreground" : "text-subtle")}>
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-[11px] tabular-nums",
          bold ? "text-xs font-bold text-accent-secondary" : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Manual release toggle — the truck only leaves the workflow (and the gate
 * register flips to Released) once execution confirms the printed slips were
 * handed to the warehouse manager.
 */
function ReleaseToggle({
  row,
  truckId,
}: {
  row: { saleReleasedAt: Date | null; saleReleasedBy: string | null };
  truckId: string;
}) {
  const utils = trpc.useUtils();
  const release = trpc.execution.markSaleReleased.useMutation({
    onSuccess: () => invalidateGateOpsCaches(utils),
  });
  if (row.saleReleasedAt) {
    return (
      <span className="text-[10px] text-success">
        Released{row.saleReleasedBy ? ` by ${row.saleReleasedBy}` : ""}
      </span>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={release.isPending}
        onClick={() => {
          if (
            confirm(
              "Mark this truck as released? Confirm only after the printed Gate Out Slip and Delivery Order have been handed to the warehouse manager.",
            )
          ) {
            release.mutate({ truckId });
          }
        }}
        className="kastros-btn-primary self-start px-3 py-1.5 text-[11px] disabled:opacity-50"
      >
        {release.isPending ? "Releasing…" : "Mark released"}
      </button>
      <span className="text-[10px] text-subtle">
        Print both slips and hand them to the warehouse manager first.
      </span>
      {release.error && <ErrorLine message={release.error.message} />}
    </div>
  );
}

function PrintLinks({ truckId }: { truckId: string }) {
  return (
    <div className="flex flex-wrap gap-3 text-[11px]">
      <Link
        href={`/execution/print/gate-out-slip/${truckId}`}
        target="_blank"
        className="font-medium text-accent-secondary hover:underline"
      >
        Gate out slip →
      </Link>
      <Link
        href={`/execution/print/delivery-order/${truckId}`}
        target="_blank"
        className="font-medium text-accent-secondary hover:underline"
      >
        Delivery order →
      </Link>
    </div>
  );
}

/**
 * Outbound sale payment step — receivable (incl. 236G) vs the buyer's approved
 * voucher credit, then trader/finance (or trader/CEO clearance) approvals.
 * Queries saleWorkflowRows once — React Query dedupes it across cells.
 */
function PaymentStep({ truck }: { truck: WorkflowTruck }) {
  const utils = trpc.useUtils();
  const { data: saleRows } = trpc.execution.saleWorkflowRows.useQuery(undefined, {
    staleTime: 15_000,
  });
  const row = useMemo(
    () => saleRows?.find((r) => r.truckId === truck.id),
    [saleRows, truck.id],
  );

  const send = trpc.execution.sendSaleForApproval.useMutation({
    onSuccess: () => invalidateGateOpsCaches(utils),
  });
  const clear = trpc.execution.requestClearWithoutPayment.useMutation({
    onSuccess: () => invalidateGateOpsCaches(utils),
  });

  if (!row || row.saleStage == null) {
    return (
      <StepPanel step={2} title="Payment" state="waiting" headline="After trade assignment">
        <span className="text-[10px] text-subtle">
          After trade assignment — the receivable (incl. 236G) and the buyer&rsquo;s ledger balance
          appear here.
        </span>
      </StepPanel>
    );
  }

  if (row.saleStage === "AWAITING_BALANCE") {
    const expected = row.saleExpectedPkr ?? 0;
    const available = row.availableCreditPkr ?? 0;
    const shortfall = expected - available;
    return (
      <StepPanel step={2} title="Payment" state="active" headline="Awaiting balance">
        <div className="space-y-0.5">
          <AmountLine label="Base" value={fmtPkr(row.saleBasePkr ?? 0)} />
          <AmountLine label="236G" value={fmtPkr(row.saleTaxPkr ?? 0)} />
          <AmountLine label="Receivable" value={fmtPkr(expected)} bold />
        </div>
        <span
          className={cn(
            "text-[10px] font-medium",
            row.canSendForApproval ? "text-success" : "text-destructive",
          )}
        >
          Buyer credit available: {fmtPkr(available)}
          {!row.canSendForApproval && shortfall > 0 && <> — short {fmtPkr(shortfall)}</>}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!row.canSendForApproval || send.isPending}
            title="Needs approved voucher credit ≥ receivable"
            onClick={() => send.mutate({ truckId: truck.id })}
            className="kastros-btn-primary px-3 py-1.5 text-[11px] disabled:opacity-50"
          >
            {send.isPending ? "Sending…" : "Send for approval"}
          </button>
          <button
            type="button"
            disabled={clear.isPending}
            onClick={() => {
              if (confirm("Release without full payment? Needs trader + CEO approval.")) {
                clear.mutate({ truckId: truck.id });
              }
            }}
            className="rounded-md border border-destructive/40 px-3 py-1.5 text-[11px] font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            {clear.isPending ? "Requesting…" : "Clear w/o payment"}
          </button>
        </div>
        {send.error && <ErrorLine message={send.error.message} />}
        {clear.error && <ErrorLine message={clear.error.message} />}
      </StepPanel>
    );
  }

  if (row.saleStage === "PENDING_TRADER") {
    return (
      <StepPanel step={2} title="Payment" state="active" headline="With trader">
        <span className="text-[10px] text-subtle">
          Awaiting trader approval — {row.tradeRef ?? "the trade"}&rsquo;s trader must approve the
          sell invoice.
        </span>
      </StepPanel>
    );
  }

  if (row.saleStage === "PENDING_FINANCE") {
    return (
      <StepPanel step={2} title="Payment" state="active" headline="With finance">
        <span className="text-[10px] text-subtle">Trader approved — awaiting finance.</span>
      </StepPanel>
    );
  }

  if (row.saleStage === "CLEAR_PENDING_TRADER" || row.saleStage === "CLEAR_PENDING_CEO") {
    return (
      <StepPanel step={2} title="Payment" state="active" headline="Clearance">
        <span className="text-[10px] font-medium text-warning">
          {row.saleStage === "CLEAR_PENDING_TRADER"
            ? `Clear-without-payment requested — awaiting ${row.tradeRef ?? "the trade"}'s trader.`
            : "Trader agreed to release without payment — awaiting CEO clearance."}
        </span>
      </StepPanel>
    );
  }

  if (row.saleStage === "CLEARED_UNPAID") {
    return (
      <StepPanel
        step={2}
        title="Payment"
        state="warn"
        headline={row.saleReleasedAt ? "Released unpaid" : "Cleared unpaid"}
      >
        <span className="truncate font-mono text-xs font-semibold text-foreground">
          {row.gateOutSlipNo ?? "—"}
          {row.deliveryOrderNo && (
            <span className="text-muted-foreground"> · {row.deliveryOrderNo}</span>
          )}
        </span>
        <PrintLinks truckId={truck.id} />
        <span className="text-[10px] text-warning">
          Receivable remains open in the buyer&rsquo;s ledger.
        </span>
        <ReleaseToggle row={row} truckId={truck.id} />
      </StepPanel>
    );
  }

  // PAYMENT_RECEIVED
  return (
    <StepPanel
      step={2}
      title="Payment"
      state="done"
      headline={row.saleReleasedAt ? "Released" : "Payment received"}
    >
      <span className="truncate font-mono text-xs font-semibold text-foreground">
        {row.gateOutSlipNo ?? "—"}
        {row.deliveryOrderNo && (
          <span className="text-muted-foreground"> · {row.deliveryOrderNo}</span>
        )}
      </span>
      <PrintLinks truckId={truck.id} />
      <ReleaseToggle row={row} truckId={truck.id} />
    </StepPanel>
  );
}
