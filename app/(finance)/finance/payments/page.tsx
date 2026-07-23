"use client";

import { useState } from "react";
import { OverdueAlertsCard } from "@/components/ledgers/overdue-alerts-card";
import { invalidateTradeFlowCaches } from "@/lib/invalidate-caches";
import { trpc } from "@/lib/trpc/client";
import { EntryActions } from "@/components/team/entry-actions";

export default function FinancePaymentsPage() {
  const utils = trpc.useUtils();
  const { data: pending } = trpc.finance.pendingPayments.useQuery();
  const [rejectComments, setRejectComments] = useState<Record<string, string>>({});
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
        <OverdueAlertsCard />
        {pending?.map((p) => {
          const comment = rejectComments[p.id] ?? "";
          return (
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
              <div className="mt-3">
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-subtle">
                  Rejection reason *
                </label>
                <div className="flex flex-wrap items-start gap-2">
                  <textarea
                    value={comment}
                    onChange={(e) => setRejectComments((c) => ({ ...c, [p.id]: e.target.value }))}
                    placeholder="Required to reject — recorded as a rejection…"
                    rows={2}
                    className="kastros-input w-72 text-xs"
                  />
                  <button
                    type="button"
                    disabled={reject.isPending || !comment.trim()}
                    onClick={() => reject.mutate({ paymentId: p.id, comment: comment.trim() })}
                    className="rounded-md border border-kastros-border px-3 py-1.5 text-xs text-muted-foreground disabled:opacity-50"
                  >
                    {reject.isPending && reject.variables?.paymentId === p.id ? "Rejecting…" : "Reject"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {!pending?.length && <p className="text-sm text-subtle">No pending payments.</p>}
      </div>
    </div>
  );
}
