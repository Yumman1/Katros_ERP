"use client";

import Link from "next/link";
import { CheckCircle2, PauseCircle } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
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
  stage: "PENDING_TRADE_APPROVAL" | "HOLD_OLD_DUES";
  warehouseName: string;
  arrivalDate: Date | string;
  tradeRef: string;
  counterpartyName: string;
  commodityName: string;
  totalTradePricePkr: number;
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
  const held = (rows ?? []).filter((r) => r.stage === "HOLD_OLD_DUES");

  return (
    <div className="kastros-desk-page">
      <PageHeader
        title="Buy Invoice Approvals"
        subtitle="Purchase-side gate invoices on your buy trades waiting for payment approval. Approving sends the invoice to payment; holding parks it against old dues."
      />

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
  const busy = resolve.isPending && resolve.variables?.truckId === row.truckId;
  const errorHere = resolve.error && resolve.variables?.truckId === row.truckId;

  return (
    <article className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-lg font-semibold text-foreground">{row.invoiceNo}</span>
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase",
              isPending ? "bg-warning/15 text-warning" : "bg-foreground/[0.08] text-subtle",
            )}
          >
            {isPending ? "Pending approval" : "Hold — old dues"}
          </span>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-subtle">Amount due</div>
          <div className="tabular-nums text-lg font-bold text-foreground">
            {formatCurrency(row.amountPkr, "PKR")}
          </div>
        </div>
      </div>

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
          {busy && resolve.variables?.decision === "APPROVE" ? "Approving…" : "Approve payment"}
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
