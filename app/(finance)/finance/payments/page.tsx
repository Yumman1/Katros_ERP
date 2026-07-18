"use client";

import { invalidateTradeFlowCaches } from "@/lib/invalidate-caches";
import { trpc } from "@/lib/trpc/client";
import { EntryActions } from "@/components/team/entry-actions";

export default function FinancePaymentsPage() {
  const utils = trpc.useUtils();
  const { data: pending } = trpc.finance.pendingPayments.useQuery();
  const approve = trpc.finance.approvePayment.useMutation({
    onSuccess: () => invalidateTradeFlowCaches(utils),
  });
  const reject = trpc.finance.rejectPayment.useMutation({
    onSuccess: () => invalidateTradeFlowCaches(utils),
  });
  const del = trpc.finance.deletePayment.useMutation({
    onSuccess: () => invalidateTradeFlowCaches(utils),
  });

  return (
    <div className="kastros-desk-page">
      <h1 className="text-2xl font-semibold text-foreground">Payment approvals</h1>
      <p className="text-sm text-subtle">
        Approve before execution can mark inbound paid or release outbound vehicles.
      </p>
      <div className="kastros-desk-scroll space-y-3 pb-6">
        {pending?.map((p) => (
          <div key={p.id} className="rounded-lg border border-kastros-border bg-kastros-card p-4">
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <div className="font-mono text-xs text-success">{p.id}</div>
                <div className="text-sm text-foreground">
                  {p.sourceType} · {p.tradeRef} · {p.counterpartyName}
                </div>
                <div className="data-grid text-lg text-foreground">
                  {p.currency} {p.amount.toLocaleString()}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={approve.isPending}
                  onClick={() => approve.mutate({ paymentId: p.id })}
                  className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-kastros-bg"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={reject.isPending}
                  onClick={() => reject.mutate({ paymentId: p.id, comment: "Rejected" })}
                  className="rounded-md border border-kastros-border px-3 py-1.5 text-xs text-muted-foreground"
                >
                  Reject
                </button>
                <EntryActions
                  department="FINANCE"
                  entityType="PAYMENT"
                  entityRef={p.id}
                  entityLabel={`${p.id} · ${p.tradeRef} · ${p.counterpartyName}`}
                  onDelete={() => del.mutateAsync({ paymentId: p.id })}
                  deleting={del.isPending}
                />
              </div>
            </div>
          </div>
        ))}
        {!pending?.length && <p className="text-sm text-subtle">No pending payments.</p>}
      </div>
    </div>
  );
}
