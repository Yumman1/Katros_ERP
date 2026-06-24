"use client";

import { invalidateTradeFlowCaches } from "@/lib/invalidate-caches";
import { trpc } from "@/lib/trpc/client";

export default function FinancePaymentsPage() {
  const utils = trpc.useUtils();
  const { data: pending } = trpc.finance.pendingPayments.useQuery();
  const approve = trpc.finance.approvePayment.useMutation({
    onSuccess: () => invalidateTradeFlowCaches(utils),
  });
  const reject = trpc.finance.rejectPayment.useMutation({
    onSuccess: () => invalidateTradeFlowCaches(utils),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-white">Payment approvals</h1>
      <p className="text-sm text-zinc-500">
        Approve before execution can mark inbound paid or release outbound vehicles.
      </p>
      <div className="space-y-3">
        {pending?.map((p) => (
          <div key={p.id} className="rounded-lg border border-kastros-border bg-kastros-card p-4">
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <div className="font-mono text-xs text-kastros-green">{p.id}</div>
                <div className="text-sm text-white">
                  {p.sourceType} · {p.tradeRef} · {p.counterpartyName}
                </div>
                <div className="data-grid text-lg text-white">
                  {p.currency} {p.amount.toLocaleString()}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={approve.isPending}
                  onClick={() => approve.mutate({ paymentId: p.id })}
                  className="rounded-md bg-kastros-green px-3 py-1.5 text-xs font-semibold text-kastros-bg"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={reject.isPending}
                  onClick={() => reject.mutate({ paymentId: p.id, comment: "Rejected" })}
                  className="rounded-md border border-kastros-border px-3 py-1.5 text-xs text-zinc-300"
                >
                  Reject
                </button>
              </div>
            </div>
          </div>
        ))}
        {!pending?.length && <p className="text-sm text-zinc-500">No pending payments.</p>}
      </div>
    </div>
  );
}
