"use client";

import { useMemo, useState } from "react";

import { Check, X } from "lucide-react";
import { ListPagination } from "@/components/ui/list-pagination";
import { PageHeader } from "@/components/ui/page-header";
import { useListPagination } from "@/lib/use-list-pagination";
import { invalidateFinanceApprovalBadges } from "@/lib/invalidate-caches";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { formatPkDate, formatPkDateTime } from "@/lib/formatters/datetime";

const pkrFormat = new Intl.NumberFormat("en-PK");

function fmtPkr(value: number): string {
  return `${pkrFormat.format(value)} PKR`;
}

/** Trade ref for reconciliation; credits without one still join the buyer pool. */
function TradeRefChip({ tradeRef }: { tradeRef: string | null }) {
  return tradeRef ? (
    <span className="rounded-full border border-accent-secondary/30 bg-accent-secondary/10 px-2 py-0.5 font-mono text-[10px] font-bold text-accent-secondary">
      Against {tradeRef}
    </span>
  ) : (
    <span
      className="rounded-full border border-border bg-foreground/[0.05] px-2 py-0.5 text-[10px] font-semibold text-subtle"
      title="Approved credit joins the buyer's shared voucher pool"
    >
      No trade ref
    </span>
  );
}

const VOUCHER_HISTORY_PAGE_SIZE = 5;

const STATUS_CHIP: Record<string, { className: string; label: string }> = {
  APPROVED: { className: "bg-success/15 text-success", label: "Approved" },
  REJECTED: { className: "bg-destructive/15 text-destructive", label: "Rejected" },
  PENDING_FINANCE: { className: "bg-warning/15 text-warning", label: "Pending finance" },
};

export function FinanceVouchersPanel() {
  const utils = trpc.useUtils();
  const { data: vouchers, isLoading, error: vouchersError } = trpc.finance.vouchers.useQuery(
    {},
    { refetchInterval: 60_000, retry: false },
  );
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});

  const invalidate = () => {
    invalidateFinanceApprovalBadges(utils);
    void utils.finance.vouchers.invalidate();
    void utils.finance.counterpartyLedgers.invalidate();
    void utils.execution.vouchers.invalidate();
    void utils.execution.saleWorkflowRows.invalidate();
    void utils.execution.counterpartyLedgers.invalidate();
  };

  const approve = trpc.finance.approveVoucher.useMutation({
    onSuccess: () => {
      invalidate();
      void utils.policy.sellInflowStatus.invalidate();
    },
  });
  const reject = trpc.finance.rejectVoucher.useMutation({
    onSuccess: () => {
      invalidate();
      void utils.policy.rejections.invalidate();
    },
  });

  const pending = useMemo(
    () => (vouchers ?? []).filter((v) => v.status === "PENDING_FINANCE"),
    [vouchers],
  );
  const resolved = useMemo(
    () =>
      (vouchers ?? [])
        .filter((v) => v.status !== "PENDING_FINANCE")
        .sort(
          (a, b) =>
            new Date(b.resolvedAt ?? b.createdAt).getTime() - new Date(a.resolvedAt ?? a.createdAt).getTime(),
        ),
    [vouchers],
  );
  const historyPagination = useListPagination(resolved, { pageSize: VOUCHER_HISTORY_PAGE_SIZE });

  return (
    <div className="kastros-desk-page space-y-6 pb-6">
      <PageHeader
        title="Voucher approvals"
        subtitle="Payments entered by execution become part of the buyer's ledger only after your approval."
      />

      <section>
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">Pending vouchers</h2>
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold text-warning">
              {pending.length}
            </span>
          </div>
          {isLoading ? (
            <div className="py-8 text-center text-sm text-subtle">Loading vouchers…</div>
          ) : vouchersError ? (
            <div className="exec-empty">You don&apos;t have access to this page.</div>
          ) : pending.length === 0 ? (
            <div className="exec-empty">No vouchers awaiting approval.</div>
          ) : (
            <div className="space-y-4">
              {pending.map((v) => {
                const busy =
                  (approve.isPending && approve.variables?.voucherId === v.id) ||
                  (reject.isPending && reject.variables?.voucherId === v.id);
                const errorHere =
                  (approve.error && approve.variables?.voucherId === v.id && approve.error.message) ||
                  (reject.error && reject.variables?.voucherId === v.id && reject.error.message) ||
                  null;
                return (
                  <article key={v.id} className="exec-panel">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-foreground">{v.voucherNo}</span>
                          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold uppercase text-warning">
                            Pending finance
                          </span>
                          <TradeRefChip tradeRef={v.tradeRef} />
                        </div>
                        <div className="mt-1 text-sm text-foreground">
                          {v.counterpartyName}{" "}
                          <span className="font-mono text-xs text-muted-foreground">({v.counterpartyCode})</span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {v.method ? `Method: ${v.method}` : "Method: —"}
                          {v.bankName ? ` · ${v.bankName}` : ""}
                          {v.reference ? ` · Ref: ${v.reference}` : ""}
                          {v.note ? ` · “${v.note}”` : ""}
                        </div>
                        <div className="mt-1 text-xs text-subtle">
                          Entered by {v.enteredByName} · {formatPkDateTime(v.createdAt)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-wider text-subtle">Amount</div>
                        <div className="text-lg font-bold tabular-nums text-foreground">{fmtPkr(v.amountPkr)}</div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <input
                        value={notes[v.id] ?? ""}
                        onChange={(e) => setNotes((n) => ({ ...n, [v.id]: e.target.value }))}
                        placeholder="Optional note…"
                        className="kastros-input w-64 text-xs"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => approve.mutate({ voucherId: v.id, note: notes[v.id] || undefined })}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-success px-4 py-2 text-xs font-bold text-white hover:bg-success/90 disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" />
                        {busy && approve.variables?.voucherId === v.id ? "Approving…" : "Approve"}
                      </button>
                    </div>
                    <div className="mt-2">
                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-subtle">
                        Rejection reason *
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={rejectReasons[v.id] ?? ""}
                          onChange={(e) => setRejectReasons((n) => ({ ...n, [v.id]: e.target.value }))}
                          placeholder="Required to reject…"
                          className="kastros-input w-64 text-xs"
                        />
                        <button
                          type="button"
                          disabled={busy || !(rejectReasons[v.id] ?? "").trim()}
                          onClick={() => reject.mutate({ voucherId: v.id, note: rejectReasons[v.id].trim() })}
                          className="kastros-btn-secondary inline-flex items-center gap-1.5 text-xs disabled:opacity-50"
                        >
                          <X className="h-3.5 w-3.5" />
                          {busy && reject.variables?.voucherId === v.id ? "Rejecting…" : "Reject"}
                        </button>
                      </div>
                    </div>
                    {errorHere && <p className="mt-2 text-xs text-destructive">{errorHere}</p>}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">History</h2>
          <div className="kastros-table-wrap min-h-[22rem]">
            {vouchersError ? (
              <div className="px-4 py-6 text-center text-xs text-subtle">
                You don&apos;t have access to this page.
              </div>
            ) : resolved.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-subtle">No resolved vouchers yet.</div>
            ) : (
              <>
                <table className="kastros-table">
                  <thead>
                    <tr>
                      <th>No</th>
                      <th>Counterparty</th>
                      <th>Trade</th>
                      <th className="text-right">Amount</th>
                      <th>Status</th>
                      <th>Resolved by</th>
                      <th>Date</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyPagination.items.map((v) => {
                      const chip = STATUS_CHIP[v.status] ?? STATUS_CHIP.PENDING_FINANCE;
                      return (
                        <tr key={v.id}>
                          <td className="whitespace-nowrap font-mono text-xs">{v.voucherNo}</td>
                          <td className="whitespace-nowrap">
                            {v.counterpartyName}{" "}
                            <span className="font-mono text-xs text-muted-foreground">({v.counterpartyCode})</span>
                          </td>
                          <td className="whitespace-nowrap">
                            <TradeRefChip tradeRef={v.tradeRef} />
                          </td>
                          <td className="whitespace-nowrap text-right tabular-nums">{fmtPkr(v.amountPkr)}</td>
                          <td className="whitespace-nowrap">
                            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", chip.className)}>
                              {chip.label}
                            </span>
                          </td>
                          <td className="whitespace-nowrap">{v.resolvedByName ?? "—"}</td>
                          <td className="whitespace-nowrap">
                            {v.resolvedAt ? formatPkDate(v.resolvedAt) : "—"}
                          </td>
                          <td className="max-w-[220px] truncate text-muted-foreground" title={v.resolutionNote ?? undefined}>
                            {v.resolutionNote ?? "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}
          </div>
          {resolved.length > 0 && (
            <ListPagination
              page={historyPagination.page}
              totalPages={historyPagination.totalPages}
              totalItems={historyPagination.totalItems}
              startIndex={historyPagination.startIndex}
              endIndex={historyPagination.endIndex}
              onPageChange={historyPagination.setPage}
            />
          )}
        </section>
    </div>
  );
}
