"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, PauseCircle, Scissors } from "lucide-react";
import { formatCurrency } from "@/lib/formatters/numbers";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

type ApprovalRow = {
  truckId: string;
  gatepassNo: string;
  truckNo: string;
  invoiceNo: string;
  amountPkr: number;
  expectedPkr: number | null;
  stage: "PENDING_TRADE_APPROVAL" | "HOLD_OLD_DUES" | "PARTIAL_PAYMENT";
  warehouseName: string;
  arrivalDate: Date | string;
  tradeRef: string;
  counterpartyName: string;
  commodityName: string;
  totalTradePricePkr: number;
  paidPkr: number;
  remainingPkr: number;
  holdNote: string | null;
  invoiceTruckCount: number;
  invoiceTruckIndex: number;
  invoiceTotalPkr: number;
};

export default function TraderInvoiceApprovalsPage() {
  const utils = trpc.useUtils();
  const { data: rows, isLoading } = trpc.trader.invoiceApprovals.useQuery(undefined, {
    refetchInterval: 20000,
  });

  const resolve = trpc.trader.resolveInvoiceApproval.useMutation({
    onSuccess: () => {
      void utils.trader.invoiceApprovals.invalidate();
      void utils.trader.invoiceApprovalsCount.invalidate();
    },
  });

  const pending = (rows ?? []).filter((r) => r.stage === "PENDING_TRADE_APPROVAL");
  const partial = (rows ?? []).filter((r) => r.stage === "PARTIAL_PAYMENT");
  const held = (rows ?? []).filter((r) => r.stage === "HOLD_OLD_DUES");

  // Page shell, header and tabs come from the layout — this renders the buy tab.
  return (
      <div className="kastros-desk-scroll space-y-6 pb-6">
        {isLoading ? (
          <div className="py-12 text-center text-sm text-subtle">Loading invoice approvals…</div>
        ) : !rows?.length ? (
          <div className="rounded-xl border border-border bg-card px-6 py-12 text-center text-sm text-subtle">
            No invoices need your attention. Invoices entered at the gate on your trades will
            appear here for payment approval.
          </div>
        ) : (
          <>
            <ApprovalGroup
              title="Awaiting your approval"
              count={pending.length}
              accent="warning"
              emptyMessage="Nothing waiting for approval."
              rows={pending}
              resolve={resolve}
            />
            <ApprovalGroup
              title="Part paid — remainder held"
              count={partial.length}
              accent="warning"
              emptyMessage="No part-paid invoices."
              rows={partial}
              resolve={resolve}
            />
            <ApprovalGroup
              title="On hold — old dues"
              count={held.length}
              accent="muted"
              emptyMessage="No invoices on hold."
              rows={held}
              resolve={resolve}
            />
          </>
        )}
      </div>
  );
}

function ApprovalGroup({
  title,
  count,
  accent,
  emptyMessage,
  rows,
  resolve,
}: {
  title: string;
  count: number;
  accent: "warning" | "muted";
  emptyMessage: string;
  rows: ApprovalRow[];
  resolve: ReturnType<typeof trpc.trader.resolveInvoiceApproval.useMutation>;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-bold",
            accent === "warning" ? "bg-warning/15 text-warning" : "bg-foreground/[0.08] text-subtle",
          )}
        >
          {count}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-5 py-6 text-center text-xs text-subtle">
          {emptyMessage}
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((r) => (
            <InvoiceCard key={r.truckId} row={r} resolve={resolve} />
          ))}
        </div>
      )}
    </section>
  );
}

function InvoiceCard({
  row,
  resolve,
}: {
  row: ApprovalRow;
  resolve: ReturnType<typeof trpc.trader.resolveInvoiceApproval.useMutation>;
}) {
  const isPending = row.stage === "PENDING_TRADE_APPROVAL";
  const isPartial = row.stage === "PARTIAL_PAYMENT";
  const multiTruck = row.invoiceTruckCount > 1;
  const busy = resolve.isPending && resolve.variables?.truckId === row.truckId;
  const errorHere = resolve.error && resolve.variables?.truckId === row.truckId;

  const [payAmount, setPayAmount] = useState("");
  const [note, setNote] = useState("");
  const wanted = Number(payAmount);
  const overRemaining = wanted > row.remainingPkr + 0.005;
  const canPartPay = wanted > 0 && !overRemaining && !busy;
  const paidPct =
    row.amountPkr > 0 ? Math.min(100, Math.round((row.paidPkr / row.amountPkr) * 100)) : 0;

  return (
    <article className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-lg font-semibold text-foreground">{row.invoiceNo}</span>
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase",
              isPending || isPartial
                ? "bg-warning/15 text-warning"
                : "bg-foreground/[0.08] text-subtle",
            )}
          >
            {isPending ? "Pending approval" : isPartial ? "Part paid" : "Hold — old dues"}
          </span>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-subtle">
            {multiTruck ? "Amount due — this truck" : "Amount due"}
          </div>
          <div className="tabular-nums text-lg font-bold text-foreground">
            {formatCurrency(row.amountPkr, "PKR")}
          </div>
        </div>
      </div>

      {/* One invoice, many trucks: pay or hold each truck on its own, so a
          single hold figure quoted for the invoice has to be split per truck. */}
      {multiTruck && (
        <p className="mt-2 text-[11px] text-subtle">
          Truck {row.invoiceTruckIndex} of {row.invoiceTruckCount} on invoice{" "}
          <span className="font-mono">{row.invoiceNo}</span> (whole invoice{" "}
          {formatCurrency(row.invoiceTotalPkr, "PKR")}) — approving or holding here applies to this
          truck only.
        </p>
      )}

      {/* Paid out of the total, so a held remainder is never invisible. */}
      {row.paidPkr > 0 && (
        <div className="mt-3 rounded-lg border border-border bg-background/40 px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
            <span className="text-subtle">
              Paid{" "}
              <span className="font-mono font-semibold text-success">
                {formatCurrency(row.paidPkr, "PKR")}
              </span>{" "}
              of {formatCurrency(row.amountPkr, "PKR")}
            </span>
            <span className="text-subtle">
              Held{" "}
              <span className="font-mono font-semibold text-warning">
                {formatCurrency(row.remainingPkr, "PKR")}
              </span>
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
            <div className="h-full rounded-full bg-success" style={{ width: `${paidPct}%` }} />
          </div>
          {row.holdNote && (
            <p className="mt-2 text-[11px] text-subtle">Hold reason: {row.holdNote}</p>
          )}
        </div>
      )}

      <div className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-3">
        <Detail label="Trade ref">
          <Link
            href={`/trader/trades/${encodeURIComponent(row.tradeRef)}`}
            className="font-mono text-accent-secondary hover:underline"
          >
            {row.tradeRef}
          </Link>
        </Detail>
        <Detail label="Counterparty">{row.counterpartyName}</Detail>
        <Detail label="Commodity">{row.commodityName}</Detail>
        <Detail label="Warehouse">{row.warehouseName}</Detail>
        <Detail label="Gatepass no">
          <span className="font-mono">{row.gatepassNo}</span>
        </Detail>
        <Detail label="Truck">{row.truckNo}</Detail>
        <Detail label="Arrival date">
          {new Date(row.arrivalDate).toLocaleDateString("en-PK")}
        </Detail>
        <Detail label="Expected amount">
          <span className="tabular-nums">
            {row.expectedPkr != null ? formatCurrency(row.expectedPkr, "PKR") : "—"}
          </span>
        </Detail>
        <Detail label="Total trade price">
          <span className="tabular-nums">{formatCurrency(row.totalTradePricePkr, "PKR")}</span>
        </Detail>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => resolve.mutate({ truckId: row.truckId, decision: "APPROVE" })}
          className="inline-flex items-center gap-1.5 rounded-lg bg-success px-4 py-2 text-xs font-bold text-white hover:bg-success/90 disabled:opacity-50"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          {busy && resolve.variables?.decision === "APPROVE"
            ? "Approving…"
            : row.paidPkr > 0
              ? `Pay remaining ${formatCurrency(row.remainingPkr, "PKR")}`
              : "Approve payment"}
        </button>
        {isPending && (
          <button
            type="button"
            disabled={busy}
            onClick={() => resolve.mutate({ truckId: row.truckId, decision: "HOLD" })}
            className="kastros-btn-secondary inline-flex items-center gap-1.5 text-xs disabled:opacity-50"
          >
            <PauseCircle className="h-3.5 w-3.5" />
            {busy && resolve.variables?.decision === "HOLD" ? "Holding…" : "Hold — old dues"}
          </button>
        )}
      </div>

      {/* Pay part of the invoice and hold the rest. Repeatable — the truck
          stays here until the whole amount has been released. */}
      <div className="mt-3 rounded-lg border border-dashed border-border px-4 py-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Scissors className="h-3.5 w-3.5 text-warning" />
          Pay part, hold the rest
        </div>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-subtle">
            Pay now (PKR)
            <input
              type="number"
              min={0}
              max={row.remainingPkr}
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              placeholder="0"
              className="kastros-input kastros-input-sm w-40"
            />
          </label>
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-[10px] uppercase tracking-wider text-subtle">
            Reason for the hold
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                multiTruck
                  ? "e.g. this truck's share of the 1M held against old dues"
                  : "e.g. 1M held against old dues"
              }
              className="kastros-input kastros-input-sm w-full"
            />
          </label>
          <button
            type="button"
            disabled={!canPartPay}
            onClick={() =>
              resolve.mutate({
                truckId: row.truckId,
                decision: "PARTIAL",
                amountPkr: wanted,
                note: note.trim() || undefined,
              })
            }
            className="rounded-lg bg-warning px-4 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy && resolve.variables?.decision === "PARTIAL" ? "Releasing…" : "Release this much"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-subtle">
          {overRemaining ? (
            <span className="text-destructive">
              Only {formatCurrency(row.remainingPkr, "PKR")} is still unpaid on this truck.
            </span>
          ) : (
            <>
              {formatCurrency(row.remainingPkr, "PKR")} still unpaid. The held amount stays
              outstanding against this truck and never ages — release it here whenever you are ready.
            </>
          )}
        </p>
      </div>
      {errorHere && <p className="mt-2 text-xs text-destructive">{resolve.error?.message}</p>}
    </article>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-subtle">{label}</div>
      <div className="mt-0.5 truncate text-sm font-medium text-foreground">{children}</div>
    </div>
  );
}
