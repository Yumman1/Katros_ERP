"use client";

import Link from "next/link";
import { useState } from "react";

import { AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { formatPkDate } from "@/lib/formatters/datetime";

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
  stage: string;
};

type UnpaidTruckRow = {
  truckId: string;
  gatepassNo: string;
  truckNo: string;
  warehouseName: string;
  tradeRef: string;
  counterpartyName: string;
  commodityName: string;
  saleExpectedPkr: number;
  releasedAt: Date | string | null;
  dueDate: Date | string | null;
  daysUntilDue: number | null;
  overdueDays: number;
  agingBucket: string;
};

function fmtPkr(v: number) {
  return `${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(v)} PKR`;
}

export default function TraderSellInvoiceApprovalsPage() {
  const utils = trpc.useUtils();
  const { data: rows, isLoading } = trpc.trader.sellInvoiceApprovals.useQuery(undefined, {
    refetchInterval: 20000,
  });
  const { data: unpaid, isLoading: unpaidLoading } = trpc.trader.unpaidSellTrucks.useQuery(
    undefined,
    { refetchInterval: 60_000 },
  );

  const resolve = trpc.trader.resolveSellInvoiceApproval.useMutation({
    onSuccess: (_data, variables) => {
      void utils.trader.sellInvoiceApprovals.invalidate();
      void utils.trader.sellInvoiceApprovalsCount.invalidate();
      void utils.trader.unpaidSellTrucks.invalidate();
      if (variables.decision === "REJECT") void utils.policy.rejections.invalidate();
    },
  });

  const clearances = rows ?? [];
  // Overdue first (most overdue on top), then soonest-due, then no-terms.
  const unpaidSorted = [...(unpaid ?? [])].sort((a, b) => {
    if (a.overdueDays !== b.overdueDays) return b.overdueDays - a.overdueDays;
    const aDays = a.daysUntilDue ?? Number.POSITIVE_INFINITY;
    const bDays = b.daysUntilDue ?? Number.POSITIVE_INFINITY;
    return aDays - bDays;
  });

  // Page shell, header and tabs come from the layout — this renders the sell tab.
  return (
      <div className="kastros-desk-scroll space-y-6 pb-6">
        <p className="text-xs text-subtle">
          Paid sale trucks clear automatically — only release-on-credit requests need your
          approval. Released-but-unpaid trucks stay below as payment reminders.
        </p>
        <section>
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">
              Release on credit — your approval
            </h2>
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold text-warning">
              {clearances.length}
            </span>
          </div>
          {isLoading ? (
            <div className="rounded-xl border border-border bg-card px-5 py-8 text-center text-sm text-subtle">
              Loading release-on-credit requests…
            </div>
          ) : clearances.length === 0 ? (
            <div className="rounded-xl border border-border bg-card px-6 py-10 text-center text-sm text-subtle">
              No release-on-credit requests. Sale trucks whose buyer has already paid clear
              automatically — only unpaid releases come here for your approval.
            </div>
          ) : (
            <div className="space-y-4">
              {clearances.map((r) => (
                <ClearanceCard key={r.truckId} row={r} resolve={resolve} />
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-1 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">Awaiting payment</h2>
            <span className="rounded-full bg-foreground/[0.08] px-2 py-0.5 text-[10px] font-bold text-subtle">
              {unpaidSorted.length}
            </span>
          </div>
          <p className="mb-2 text-xs text-subtle">
            These trucks were released on credit. They stay here, aging, until finance settles
            their payment on the Counterparty Ledgers page.
          </p>
          {unpaidLoading ? (
            <div className="rounded-xl border border-border bg-card px-5 py-6 text-center text-xs text-subtle">
              Loading unpaid trucks…
            </div>
          ) : unpaidSorted.length === 0 ? (
            <div className="rounded-xl border border-border bg-card px-5 py-6 text-center text-xs text-subtle">
              No released trucks are awaiting payment.
            </div>
          ) : (
            <div className="space-y-2">
              {unpaidSorted.map((r) => (
                <UnpaidTruckRowCard key={r.truckId} row={r} />
              ))}
            </div>
          )}
        </section>
      </div>
  );
}

function ClearanceCard({
  row,
  resolve,
}: {
  row: SellApprovalRow;
  resolve: ReturnType<typeof trpc.trader.resolveSellInvoiceApproval.useMutation>;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const busy = resolve.isPending && resolve.variables?.truckId === row.truckId;
  const errorHere = resolve.error && resolve.variables?.truckId === row.truckId;

  return (
    <article className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-lg font-semibold text-foreground">{row.gatepassNo}</span>
          <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-[10px] font-bold uppercase text-warning">
            Release on credit
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
        <Detail label="Arrival date">{formatPkDate(row.arrivalDate)}</Detail>
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

      <p className="mt-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Buyer has not paid — approving sends this to the CEO; on release the buyer&apos;s ledger
        goes negative.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => resolve.mutate({ truckId: row.truckId, decision: "APPROVE" })}
          className="inline-flex items-center gap-1.5 rounded-lg bg-success px-4 py-2 text-xs font-bold text-white hover:bg-success/90 disabled:opacity-50"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          {busy && resolve.variables?.decision === "APPROVE" ? "Approving…" : "Approve → CEO"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setRejectOpen((v) => !v)}
          className="kastros-btn-secondary inline-flex items-center gap-1.5 text-xs disabled:opacity-50"
        >
          <XCircle className="h-3.5 w-3.5" />
          {rejectOpen ? "Cancel reject" : "Reject"}
        </button>
      </div>

      {rejectOpen && (
        <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <label className="text-xs font-medium text-muted-foreground">
            Reason — shown on all dashboards
          </label>
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this release being rejected?"
            className="kastros-input mt-1 w-full"
          />
          <button
            type="button"
            disabled={busy || !reason.trim()}
            onClick={() =>
              resolve.mutate({ truckId: row.truckId, decision: "REJECT", reason: reason.trim() })
            }
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-destructive px-4 py-2 text-xs font-bold text-white hover:bg-destructive/90 disabled:opacity-50"
          >
            <XCircle className="h-3.5 w-3.5" />
            {busy && resolve.variables?.decision === "REJECT" ? "Rejecting…" : "Reject release"}
          </button>
        </div>
      )}
      {errorHere && <p className="mt-2 text-xs text-destructive">{resolve.error?.message}</p>}
    </article>
  );
}

function UnpaidTruckRowCard({ row }: { row: UnpaidTruckRow }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-mono text-sm font-semibold text-foreground">{row.gatepassNo}</span>
        <span className="text-xs text-muted-foreground">{row.truckNo}</span>
        <span className="max-w-[180px] truncate text-xs text-muted-foreground">
          {row.counterpartyName}
        </span>
        <Link
          href={`/trader/trades/${encodeURIComponent(row.tradeRef)}`}
          className="font-mono text-xs text-accent-secondary hover:underline"
        >
          {row.tradeRef}
        </Link>
        <span className="tabular-nums text-xs font-semibold text-foreground">
          {fmtPkr(row.saleExpectedPkr)}
        </span>
        <span className="text-xs text-subtle">
          Released {row.releasedAt ? formatPkDate(row.releasedAt) : "—"}
        </span>
      </div>
      <DueChip row={row} />
    </div>
  );
}

function DueChip({ row }: { row: UnpaidTruckRow }) {
  if (!row.dueDate) {
    return (
      <span className="rounded-full bg-foreground/[0.06] px-2.5 py-1 text-[11px] font-medium text-subtle">
        No credit terms
      </span>
    );
  }
  if (row.overdueDays > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2.5 py-1 text-[11px] font-bold text-destructive">
        <Clock className="h-3 w-3" />
        Overdue {row.overdueDays}d · {row.agingBucket}
      </span>
    );
  }
  if (row.daysUntilDue != null && row.daysUntilDue > 0) {
    return (
      <span
        className={cn(
          "rounded-full px-2.5 py-1 text-[11px] font-medium",
          row.daysUntilDue <= 5
            ? "bg-warning/15 font-bold text-warning"
            : "bg-foreground/[0.06] text-subtle",
        )}
      >
        {row.daysUntilDue} day{row.daysUntilDue === 1 ? "" : "s"} left
      </span>
    );
  }
  return (
    <span className="rounded-full bg-warning/15 px-2.5 py-1 text-[11px] font-bold text-warning">
      Due today
    </span>
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
