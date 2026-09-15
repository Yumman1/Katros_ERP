"use client";

import { useRecordFilters } from "@/components/ui/record-filters";
import { field, tradeFields } from "@/lib/record-filters";

import Link from "next/link";
import { useState } from "react";
import { Check, X } from "lucide-react";
import { ListPagination } from "@/components/ui/list-pagination";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";
import { DESK_REFETCH_MS, invalidateApprovalCaches } from "@/lib/invalidate-caches";
import { formatPkDateTime } from "@/lib/formatters/datetime";
import { trpc } from "@/lib/trpc/client";
import { useListPagination } from "@/lib/use-list-pagination";
import { useTeam } from "@/lib/use-team";
import { canActOnDepartment } from "@/lib/departments";

const fmtPkr = (n: number | null) =>
  n != null ? `${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(n)} PKR` : "—";

export function DoApprovalsPanel() {
  const utils = trpc.useUtils();
  const { role, isHead } = useTeam();
  const isExecutionHead = role != null && canActOnDepartment(role, isHead, "EXECUTION");

  const { data: rows, isLoading } = trpc.execution.doExecutionApprovals.useQuery(undefined, {
    refetchInterval: DESK_REFETCH_MS,
  });

  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});

  const approve = trpc.execution.approveDoExecution.useMutation({
    onSuccess: () => invalidateApprovalCaches(utils),
  });
  const reject = trpc.execution.rejectDoExecution.useMutation({
    onSuccess: () => invalidateApprovalCaches(utils),
  });

  const listFilters = useRecordFilters("do-approvals", rows ?? [], { fields: [tradeFields[3], field("warehouse", "Warehouse", "warehouseName")], date: { label: "Arrival date", paths: ["arrivalDate"] } });
  const pagination = useListPagination(listFilters.rows, { resetKey: listFilters.resetKey });
  const busy = approve.isPending || reject.isPending;

  if (isLoading && !rows) {
    return <PageLoadingSkeleton label="Loading delivery orders…" rows={6} />;
  }

  return (
    <div className="kastros-desk-scroll pt-4">
        {listFilters.controls}
      {!rows?.length ? (
        <p className="text-sm text-subtle">No delivery orders awaiting execution approval.</p>
      ) : (
        <>
          <div className="kastros-table-wrap">
            <table className="kastros-table text-xs">
              <thead>
                <tr>
                  {["DO", "Gatepass", "Buyer", "Warehouse", "Trade", "Receivable", "Arrival", ""].map(
                    (h) => (
                      <th key={h} className="px-4">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {pagination.items.map((r) => {
                  const rejectReason = rejectReasons[r.truckId] ?? "";
                  const rejecting =
                    reject.isPending && reject.variables?.truckId === r.truckId;
                  const approving =
                    approve.isPending && approve.variables?.truckId === r.truckId;

                  return (
                    <tr key={r.truckId}>
                      <td className="px-4 font-mono font-semibold">{r.deliveryOrderNo ?? "—"}</td>
                      <td className="px-4 font-mono">{r.gatepassNo}</td>
                      <td className="px-4">{r.counterpartyName}</td>
                      <td className="px-4">{r.warehouseName}</td>
                      <td className="px-4 font-mono">
                        {r.tradeRef ? (
                          <Link
                            href={`/execution/open-trades/${encodeURIComponent(r.tradeRef)}`}
                            className="text-accent-secondary hover:underline"
                          >
                            {r.tradeRef}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 tabular-nums">{fmtPkr(r.saleExpectedPkr)}</td>
                      <td className="px-4 whitespace-nowrap">{formatPkDateTime(r.arrivalDate)}</td>
                      <td className="px-4">
                        <div className="flex min-w-[220px] flex-col gap-2">
                          <Link
                            href={`/execution/print/delivery-order/${r.truckId}`}
                            target="_blank"
                            className="text-accent-secondary hover:underline"
                          >
                            View DO
                          </Link>
                          {isExecutionHead ? (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => approve.mutate({ truckId: r.truckId })}
                                className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-[11px] font-semibold text-kastros-bg hover:opacity-90 disabled:opacity-50"
                              >
                                <Check className="h-3.5 w-3.5" />
                                {approving ? "Approving…" : "Approve"}
                              </button>
                              <input
                                value={rejectReason}
                                onChange={(e) =>
                                  setRejectReasons((prev) => ({
                                    ...prev,
                                    [r.truckId]: e.target.value,
                                  }))
                                }
                                placeholder="Rejection reason *"
                                className="kastros-input text-[11px]"
                              />
                              <button
                                type="button"
                                disabled={busy || !rejectReason.trim()}
                                onClick={() =>
                                  reject.mutate({ truckId: r.truckId, reason: rejectReason.trim() })
                                }
                                className="inline-flex items-center gap-1 rounded-md border border-kastros-border px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-foreground/5 disabled:opacity-50"
                              >
                                <X className="h-3.5 w-3.5" />
                                {rejecting ? "Rejecting…" : "Reject"}
                              </button>
                            </>
                          ) : (
                            <span className="text-[10px] text-subtle">Awaiting head approval</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ListPagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.totalItems}
            startIndex={pagination.startIndex}
            endIndex={pagination.endIndex}
            onPageChange={pagination.setPage}
          />
        </>
      )}
    </div>
  );
}
