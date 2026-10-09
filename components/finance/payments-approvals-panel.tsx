"use client";
import { downloadPurchaseInvoice } from "@/lib/purchase-invoice-pdf";

import { useState } from "react";
import { OverdueAlertsCard } from "@/components/ledgers/overdue-alerts-card";
import { invalidateFinanceApprovalBadges, invalidateTradeFlowCaches } from "@/lib/invalidate-caches";
import { trpc } from "@/lib/trpc/client";
import { EntryActions } from "@/components/team/entry-actions";

export function FinancePaymentsPanel() {
  const utils = trpc.useUtils();
  const completed=trpc.finance.completedPurchasePayments.useQuery();
  const download=async(id:string)=>{try{await downloadPurchaseInvoice(await utils.finance.purchaseInvoiceDocument.fetch({requestRef:id}));}catch(e){alert(e instanceof Error?e.message:"PDF download failed");}};
  const { data: pending, error: pendingError, isLoading } = trpc.finance.pendingPayments.useQuery(undefined, {
    retry: false,
    refetchInterval: 60_000,
  });
  const [references,setReferences]=useState<Record<string,string>>({});
  const [rejectComments, setRejectComments] = useState<Record<string, string>>({});
  const approve = trpc.finance.approvePayment.useMutation({
    onSuccess: () => {
      void utils.finance.completedPurchasePayments.invalidate();
      invalidateTradeFlowCaches(utils);
      invalidateFinanceApprovalBadges(utils);
      void utils.finance.counterpartyLedgers.invalidate();
      void utils.policy.overdueLedgerAlerts.invalidate();
    },
  });
  const reject = trpc.finance.rejectPayment.useMutation({
    onSuccess: () => {
      void utils.finance.completedPurchasePayments.invalidate();
      invalidateTradeFlowCaches(utils);
      invalidateFinanceApprovalBadges(utils);
      void utils.finance.counterpartyLedgers.invalidate();
      void utils.policy.overdueLedgerAlerts.invalidate();
      void utils.policy.rejections.invalidate();
    },
  });
  const del = trpc.finance.deletePayment.useMutation({
    onSuccess: () => {
      void utils.finance.completedPurchasePayments.invalidate();
      invalidateTradeFlowCaches(utils);
      invalidateFinanceApprovalBadges(utils);
    },
  });

  return (
    <div className="kastros-desk-page">
      <h1 className="text-2xl font-semibold text-foreground">Payment approvals</h1>
      <p className="text-sm text-subtle">
        Purchase-side payments to sellers — approve before execution can mark inbound trucks paid.
      </p>
      <div className="kastros-desk-scroll space-y-3 pb-6">
        <OverdueAlertsCard />
        {(approve.error || reject.error || del.error) && <p role="alert" className="text-sm text-destructive">{approve.error?.message ?? reject.error?.message ?? del.error?.message}</p>}
        {isLoading && <p role="status" className="text-sm text-subtle">Loading payments…</p>}
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
                  {p.advanceVoucherNo && <p className="text-xs text-muted-foreground">Builty {p.builtyNumber} · Invoice {p.invoiceNumber} · Advance {p.advanceVoucherNo} · {p.remainingPercentage}% remaining terms (actual balance below)</p>}
                  <div className="data-grid text-lg text-foreground">
                    {p.currency} {p.amount.toLocaleString()}
                  </div>
                </div>
                <div className="flex gap-2">
                  {p.sourceType === "INBOUND" && <button className="text-xs underline" onClick={()=>void download(p.id)}>Download printable invoice</button>}
                  <button
                    type="button"
                    disabled={approve.isPending || (p.sourceType === "INBOUND" && !references[p.id]?.trim())}
                    onClick={() => approve.mutate({ paymentId: p.id,paymentReference:references[p.id] })}
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
              {p.sourceType === "INBOUND" && <label className="block mt-3 text-xs">Payment slip reference *<input className="kastros-input ml-2" value={references[p.id]??""} onChange={e=>setReferences(r=>({...r,[p.id]:e.target.value}))} /></label>}
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
        <section className="space-y-2"><h2 className="font-semibold">Completed purchase payments</h2>{completed.data?.map(p=><div className="text-sm" key={p.id}>{p.tradeRef} · Builty {p.builtyNumber} · Invoice {p.invoiceNumber} · Reference {p.paymentReference ?? "Historical payment"} <button className="underline" onClick={()=>void download(p.id)}>Download completed invoice</button></div>)}</section>
        {pendingError ? (
          <p className="text-sm text-subtle">You don&apos;t have access to this page.</p>
        ) : (
          !isLoading && !pending?.length && <p className="text-sm text-subtle">No pending payments.</p>
        )}
      </div>
    </div>
  );
}
