"use client";

import { useRecordFilters } from "@/components/ui/record-filters";
import { rejectionFilterConfig } from "@/lib/record-filters";

import Link from "next/link";
import { useMemo, useState } from "react";
import { XCircle } from "lucide-react";
import { ListPagination } from "@/components/ui/list-pagination";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";
import { DESK_REFETCH_MS } from "@/lib/invalidate-caches";
import { formatPkDateTime } from "@/lib/formatters/datetime";
import {
  EXECUTION_REJECTION_FILTERS,
  humanizeRejectionKind,
} from "@/lib/rejection-kinds";
import { trpc } from "@/lib/trpc/client";
import { useListPagination } from "@/lib/use-list-pagination";
import { cn } from "@/lib/utils";

type FilterKey = "all" | "team" | "do" | "operations";

const FILTERS: { key: FilterKey; label: string; kinds: readonly string[] | null }[] = [
  { key: "all", label: "All", kinds: null },
  { key: "team", label: "Team", kinds: EXECUTION_REJECTION_FILTERS.team },
  { key: "do", label: "DO", kinds: EXECUTION_REJECTION_FILTERS.do },
  { key: "operations", label: "Operations", kinds: EXECUTION_REJECTION_FILTERS.operations },
];

const fmtPkr = (n: number) =>
  `${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(n)} PKR`;

export function ExecutionRejectionsPanel() {
  const [filter, setFilter] = useState<FilterKey>("all");
  const { data: rejections, isLoading } = trpc.policy.rejections.useQuery({ fullHistory: true }, {
    refetchInterval: DESK_REFETCH_MS,
  });

  const filtered = useMemo(() => {
    const list = rejections ?? [];
    const kinds = FILTERS.find((f) => f.key === filter)?.kinds;
    return kinds ? list.filter((r) => kinds.includes(r.kind)) : list;
  }, [rejections, filter]);

  const listFilters = useRecordFilters("rejections", filtered, rejectionFilterConfig);
  const pagination = useListPagination(listFilters.rows, { resetKey: listFilters.resetKey });

  const countFor = (kinds: readonly string[] | null) => {
    const list = rejections ?? [];
    return kinds ? list.filter((r) => kinds.includes(r.kind)).length : list.length;
  };

  if (isLoading && !rejections) {
    return <PageLoadingSkeleton label="Loading rejections…" rows={8} />;
  }

  return (
    <div className="kastros-desk-scroll flex flex-col gap-4 pt-4">
        {listFilters.controls}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const count = countFor(f.kinds);
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium",
                active
                  ? "border-success bg-success/10 text-success"
                  : "border-kastros-border text-muted-foreground hover:bg-foreground/5",
              )}
            >
              {f.label}
              {count > 0 ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                    active ? "bg-success/20 text-success" : "bg-foreground/[0.08] text-subtle",
                  )}
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="kastros-table-wrap">
        <table className="kastros-table text-xs">
          <thead>
            <tr>
              {[
                "Date",
                "Kind",
                "Ref",
                "Trade",
                "Counterparty",
                "Amount",
                "Rejected by",
                "Reason",
              ].map((h) => (
                <th key={h} className="px-5">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pagination.items.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                  {formatPkDateTime(r.createdAt)}
                </td>
                <td className="whitespace-nowrap px-5 py-3 text-foreground">
                  {humanizeRejectionKind(r.kind)}
                </td>
                <td className="px-5 py-3">
                  <span className="font-mono font-semibold text-foreground">{r.refLabel}</span>
                  {r.gatepassNo && r.gatepassNo !== r.refLabel && (
                    <div className="font-mono text-subtle">{r.gatepassNo}</div>
                  )}
                  {r.voucherNo && r.voucherNo !== r.refLabel && (
                    <div className="font-mono text-subtle">{r.voucherNo}</div>
                  )}
                </td>
                <td className="whitespace-nowrap px-5 py-3 font-mono text-muted-foreground">
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
                <td className="px-5 py-3 text-muted-foreground">{r.counterpartyName ?? "—"}</td>
                <td className="whitespace-nowrap px-5 py-3 font-mono font-semibold tabular-nums text-foreground">
                  {r.amountPkr != null ? fmtPkr(r.amountPkr) : "—"}
                </td>
                <td className="px-5 py-3">
                  <div className="text-foreground">{r.rejectedBy}</div>
                  <div className="text-[10px] uppercase tracking-wider text-subtle">
                    {r.rejectedRole}
                  </div>
                </td>
                <td className="max-w-[280px] px-5 py-3">
                  <span className="block truncate text-destructive" title={r.reason}>
                    {r.reason}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center px-5 py-12 text-center">
            <XCircle className="mb-2 h-8 w-8 text-subtle" />
            <p className="text-sm text-subtle">No rejections in this category yet</p>
          </div>
        )}
      </div>
      <ListPagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.totalItems}
        startIndex={pagination.startIndex}
        endIndex={pagination.endIndex}
        onPageChange={pagination.setPage}
      />
    </div>
  );
}
