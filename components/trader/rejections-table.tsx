"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ListPagination } from "@/components/ui/list-pagination";
import { trpc } from "@/lib/trpc/client";
import { humanizeRejectionKind } from "@/lib/rejection-kinds";

const PAGE_SIZE = 25;

function fmtPkr(v: number) {
  return `${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(v)} PKR`;
}

/**
 * One rejection list, filtered to the kinds a tab covers. Passing no kinds
 * shows every rejection on the trader's trades.
 */
export function RejectionsTable({
  kinds,
  emptyMessage,
}: {
  kinds?: readonly string[];
  emptyMessage: string;
}) {
  const { data: rows, isLoading } = trpc.policy.rejections.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const [page, setPage] = useState(1);

  const all = useMemo(() => {
    const list = rows ?? [];
    return kinds ? list.filter((r) => kinds.includes(r.kind)) : list;
  }, [rows, kinds]);

  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const pageRows = all.slice(startIndex, startIndex + PAGE_SIZE);

  return (
    <div className="kastros-desk-scroll pb-6">
      {isLoading ? (
        <div className="rounded-xl border border-border bg-card px-6 py-12 text-center text-sm text-subtle">
          Loading rejections…
        </div>
      ) : all.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-6 py-12 text-center text-sm text-subtle">
          {emptyMessage}
        </div>
      ) : (
        <div className="kastros-table-wrap">
          <table className="kastros-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Kind</th>
                <th>Ref</th>
                <th>Trade</th>
                <th>Counterparty</th>
                <th className="text-right">Amount</th>
                <th>Rejected by</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-xs text-subtle">
                    {format(new Date(r.createdAt), "dd MMM yyyy HH:mm")}
                  </td>
                  <td className="whitespace-nowrap text-xs font-medium text-foreground">
                    {humanizeRejectionKind(r.kind)}
                  </td>
                  <td className="whitespace-nowrap font-mono text-xs text-foreground">
                    {r.gatepassNo ?? r.voucherNo ?? r.refLabel}
                  </td>
                  <td className="whitespace-nowrap">
                    {r.tradeRef ? (
                      <Link
                        href={`/trader/trades/${encodeURIComponent(r.tradeRef)}`}
                        className="font-mono text-xs text-accent-secondary hover:underline"
                      >
                        {r.tradeRef}
                      </Link>
                    ) : (
                      <span className="text-xs text-subtle">—</span>
                    )}
                  </td>
                  <td className="max-w-[180px] truncate text-xs text-muted-foreground">
                    {r.counterpartyName ?? "—"}
                  </td>
                  <td className="whitespace-nowrap text-right text-xs tabular-nums text-foreground">
                    {r.amountPkr != null ? fmtPkr(r.amountPkr) : "—"}
                  </td>
                  <td className="whitespace-nowrap text-xs text-muted-foreground">
                    {r.rejectedBy}
                    <span className="ml-1 text-subtle">({r.rejectedRole})</span>
                  </td>
                  <td className="min-w-[220px] max-w-[360px] whitespace-normal break-words text-xs text-destructive">
                    {r.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ListPagination
            page={safePage}
            totalPages={totalPages}
            totalItems={all.length}
            startIndex={startIndex + 1}
            endIndex={Math.min(startIndex + PAGE_SIZE, all.length)}
            onPageChange={setPage}
          />
        </div>
      )}
    </div>
  );
}
