"use client";

import { format } from "date-fns";
import { CheckCircle2, X } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const pkrFormat = new Intl.NumberFormat("en-PK");

function fmtPkr(value: number): string {
  return `${pkrFormat.format(value)} PKR`;
}

export default function FinanceSaleApprovalsPage() {
  const utils = trpc.useUtils();
  const { data: rows, isLoading } = trpc.finance.saleApprovals.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const resolve = trpc.finance.resolveSaleApproval.useMutation({
    onSuccess: () => {
      void utils.finance.saleApprovals.invalidate();
      void utils.finance.saleApprovalsCount.invalidate();
      void utils.finance.counterpartyLedgers.invalidate();
    },
  });

  return (
    <div className="kastros-desk-page">
      <PageHeader
        title="Sell invoice approvals"
        subtitle="Outbound trucks approved by the trader — your approval marks payment received and releases the truck (Gate Out Slip + Delivery Order are issued)."
      />

      <div className="kastros-desk-scroll space-y-4 pb-6">
        {isLoading ? (
          <div className="py-12 text-center text-sm text-subtle">Loading sell invoice approvals…</div>
        ) : !rows?.length ? (
          <div className="exec-empty">
            No sell invoices awaiting finance approval. Trader-approved outbound trucks will appear here.
          </div>
        ) : (
          rows.map((r) => {
            const busy = resolve.isPending && resolve.variables?.truckId === r.truckId;
            const errorHere = resolve.error && resolve.variables?.truckId === r.truckId;
            return (
              <article key={r.truckId} className="exec-panel">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-foreground">{r.gatepassNo}</span>
                      <span className="text-sm text-foreground">{r.truckNo}</span>
                      <span className="text-xs text-muted-foreground">
                        {r.warehouseName} · Arrived {format(new Date(r.arrivalDate), "d MMM yyyy")}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-xs text-accent-secondary">{r.tradeRef}</div>
                    <div className="mt-1 text-sm text-foreground">
                      {r.counterpartyName} · {r.commodityName}
                    </div>
                    <div className="mt-1 text-xs text-success">
                      Trader {r.traderName} approved
                      {r.saleTraderApprovedBy ? ` · ${r.saleTraderApprovedBy}` : ""}
                    </div>
                  </div>

                  <div className="flex flex-wrap justify-end gap-x-6 gap-y-2 text-right">
                    <Amount label="Base" value={fmtPkr(r.saleBasePkr)} className="text-foreground" />
                    <Amount label="236G tax" value={fmtPkr(r.saleTaxPkr)} className="text-foreground" />
                    <Amount
                      label="Total receivable"
                      value={fmtPkr(r.saleExpectedPkr)}
                      className="text-base font-bold text-foreground"
                    />
                    <Amount
                      label="Buyer ledger balance"
                      value={fmtPkr(r.buyerBalancePkr)}
                      className={r.buyerBalancePkr >= 0 ? "text-success" : "text-destructive"}
                    />
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => resolve.mutate({ truckId: r.truckId, decision: "APPROVE" })}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-success px-4 py-2 text-xs font-bold text-white hover:bg-success/90 disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {busy && resolve.variables?.decision === "APPROVE"
                      ? "Approving…"
                      : "Approve — payment received"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => resolve.mutate({ truckId: r.truckId, decision: "REJECT" })}
                    className="kastros-btn-secondary inline-flex items-center gap-1.5 text-xs disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" />
                    {busy && resolve.variables?.decision === "REJECT" ? "Rejecting…" : "Reject"}
                  </button>
                </div>
                {errorHere && <p className="mt-2 text-xs text-destructive">{resolve.error?.message}</p>}
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}

function Amount({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-subtle">{label}</div>
      <div className={cn("text-sm font-semibold tabular-nums", className)}>{value}</div>
    </div>
  );
}
