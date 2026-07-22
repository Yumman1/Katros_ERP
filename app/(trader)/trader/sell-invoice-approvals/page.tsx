"use client";

import Link from "next/link";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

type SellApprovalRow = {
  truckId: string;
  gatepassNo: string;
  truckNo: string;
  arrivalDate: Date | string;
  warehouseName: string;
  tradeRef: string;
  counterpartyName: string;
  commodityName: string;
  saleBasePkr: number;
  saleTaxPkr: number;
  saleExpectedPkr: number;
  buyerBalancePkr: number;
  stage: "PENDING_TRADER" | "CLEAR_PENDING_TRADER";
};

function fmtPkr(v: number) {
  return `${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(v)} PKR`;
}

export default function TraderSellInvoiceApprovalsPage() {
  const utils = trpc.useUtils();
  const { data: rows, isLoading } = trpc.trader.sellInvoiceApprovals.useQuery(undefined, {
    refetchInterval: 20000,
  });

  const resolve = trpc.trader.resolveSellInvoiceApproval.useMutation({
    onSuccess: () => {
      void utils.trader.sellInvoiceApprovals.invalidate();
      void utils.trader.sellInvoiceApprovalsCount.invalidate();
    },
  });

  const payments = (rows ?? []).filter((r) => r.stage === "PENDING_TRADER");
  const clearances = (rows ?? []).filter((r) => r.stage === "CLEAR_PENDING_TRADER");

  return (
    <div className="kastros-desk-page">
      <PageHeader
        title="Sell Invoice Approvals"
        subtitle="Outbound sale trucks on your trades waiting for your decision — payment approvals go to finance; clear-without-payment requests go to the CEO."
      />

      <div className="kastros-desk-scroll space-y-6 pb-6">
        {isLoading ? (
          <div className="py-12 text-center text-sm text-subtle">Loading sell invoice approvals…</div>
        ) : !rows?.length ? (
          <div className="rounded-xl border border-border bg-card px-6 py-12 text-center text-sm text-subtle">
            No outbound trucks need your attention. Sale trucks sent for approval on your trades
            will appear here.
          </div>
        ) : (
          <>
            <SellApprovalGroup
              title="Payment approvals"
              count={payments.length}
              accent="warning"
              emptyMessage="No trucks waiting for payment approval."
              rows={payments}
              resolve={resolve}
            />
            <SellApprovalGroup
              title="Clear-without-payment requests"
              count={clearances.length}
              accent="muted"
              emptyMessage="No clear-without-payment requests."
              rows={clearances}
              resolve={resolve}
            />
          </>
        )}
      </div>
    </div>
  );
}

function SellApprovalGroup({
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
  rows: SellApprovalRow[];
  resolve: ReturnType<typeof trpc.trader.resolveSellInvoiceApproval.useMutation>;
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
            <SellInvoiceCard key={r.truckId} row={r} resolve={resolve} />
          ))}
        </div>
      )}
    </section>
  );
}

function SellInvoiceCard({
  row,
  resolve,
}: {
  row: SellApprovalRow;
  resolve: ReturnType<typeof trpc.trader.resolveSellInvoiceApproval.useMutation>;
}) {
  const isClearance = row.stage === "CLEAR_PENDING_TRADER";
  const busy = resolve.isPending && resolve.variables?.truckId === row.truckId;
  const errorHere = resolve.error && resolve.variables?.truckId === row.truckId;

  return (
    <article className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-lg font-semibold text-foreground">{row.gatepassNo}</span>
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase",
              isClearance ? "bg-warning/15 text-warning" : "bg-success/15 text-success",
            )}
          >
            {isClearance ? "Clear without payment" : "Payment approval"}
          </span>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-subtle">Total receivable</div>
          <div className="tabular-nums text-lg font-bold text-foreground">
            {fmtPkr(row.saleExpectedPkr)}
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
        <Detail label="Buyer">{row.counterpartyName}</Detail>
        <Detail label="Commodity">{row.commodityName}</Detail>
        <Detail label="Warehouse">{row.warehouseName}</Detail>
        <Detail label="Truck">{row.truckNo}</Detail>
        <Detail label="Arrival date">{format(new Date(row.arrivalDate), "dd MMM yyyy")}</Detail>
        <Detail label="Base">
          <span className="tabular-nums">{fmtPkr(row.saleBasePkr)}</span>
        </Detail>
        <Detail label="236G">
          <span className="tabular-nums">{fmtPkr(row.saleTaxPkr)}</span>
        </Detail>
        <Detail label="Buyer ledger balance">
          <span
            className={cn(
              "tabular-nums font-semibold",
              row.buyerBalancePkr >= 0 ? "text-success" : "text-destructive",
            )}
          >
            {fmtPkr(row.buyerBalancePkr)}
          </span>
        </Detail>
      </div>

      {isClearance && (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Execution asked to release this truck without full payment — your approval sends it to
          the CEO.
        </p>
      )}

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
            : isClearance
              ? "Approve → CEO"
              : "Approve payment"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => resolve.mutate({ truckId: row.truckId, decision: "REJECT" })}
          className="kastros-btn-secondary inline-flex items-center gap-1.5 text-xs disabled:opacity-50"
        >
          <XCircle className="h-3.5 w-3.5" />
          {busy && resolve.variables?.decision === "REJECT" ? "Rejecting…" : "Reject"}
        </button>
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
