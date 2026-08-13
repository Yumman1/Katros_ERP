"use client";

import { useMemo } from "react";
import { Clock, XCircle } from "lucide-react";
import { ListPagination } from "@/components/ui/list-pagination";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";
import { DESK_REFETCH_MS } from "@/lib/invalidate-caches";
import { formatPkDateTime } from "@/lib/formatters/datetime";
import { trpc } from "@/lib/trpc/client";
import { useListPagination } from "@/lib/use-list-pagination";
import type { ChangeRequestStatus } from "@/lib/departments";
import { ChangeRequestPayloadPreview } from "@/components/team/trade-edit-change-preview";

const STATUS_STYLE: Record<
  ChangeRequestStatus,
  { bg: string; color: string; label: string }
> = {
  PENDING: { bg: "rgba(245,158,11,0.15)", color: "#fbbf24", label: "Pending" },
  PENDING_CEO: { bg: "rgba(59,130,246,0.15)", color: "#60a5fa", label: "Awaiting CEO" },
  APPROVED: { bg: "rgba(16,185,129,0.15)", color: "#34d399", label: "Approved" },
  REJECTED: { bg: "rgba(239,68,68,0.15)", color: "#f87171", label: "Rejected" },
};

const APPROVAL_STATUSES = new Set<ChangeRequestStatus>(["PENDING", "PENDING_CEO", "APPROVED"]);

export function ExecutionMyApprovalsPanel({ filter }: { filter: "approvals" | "rejections" }) {
  const { data: mine, isLoading } = trpc.team.myChangeRequests.useQuery(undefined, {
    refetchInterval: DESK_REFETCH_MS,
  });

  const items = useMemo(() => {
    const list = mine ?? [];
    return filter === "approvals"
      ? list.filter((r) => APPROVAL_STATUSES.has(r.status))
      : list.filter((r) => r.status === "REJECTED");
  }, [mine, filter]);

  const pagination = useListPagination(items);

  if (isLoading && !mine) {
    return (
      <PageLoadingSkeleton
        label={filter === "approvals" ? "Loading your approvals…" : "Loading your rejections…"}
        rows={6}
      />
    );
  }

  const emptyMessage =
    filter === "approvals"
      ? "No active or approved requests. Submissions awaiting the execution head or CEO appear here once approved."
      : "No rejected requests. When the head or CEO turns down one of your submissions, it appears here with their reason.";

  return (
    <div className="kastros-desk-scroll pt-4">
      <section className="rounded-xl border border-kastros-border bg-kastros-card">
        <div className="flex items-center gap-2 border-b border-kastros-border px-5 py-3 text-sm font-semibold text-foreground">
          {filter === "approvals" ? (
            <>
              <Clock className="h-4 w-4 text-success" />
              Approvals
            </>
          ) : (
            <>
              <XCircle className="h-4 w-4 text-destructive" />
              Rejections
            </>
          )}
        </div>
        <div className="divide-y divide-kastros-border">
          {items.length === 0 && (
            <div className="px-5 py-8 text-sm text-subtle">{emptyMessage}</div>
          )}
          {pagination.items.map((r) => {
            const style = STATUS_STYLE[r.status];
            return (
              <div key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-subtle">{r.id}</span>
                    <span className="text-[10px] uppercase tracking-wider text-subtle">
                      {r.action} · {r.entityType}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-sm text-foreground">{r.entityLabel}</div>
                  <div className="text-xs text-subtle">“{r.comment}”</div>
                  <div className="mt-1 text-xs text-subtle">
                    Submitted {formatPkDateTime(r.requestedAt)}
                  </div>
                  {r.payload && r.action === "EDIT" && (
                    <ChangeRequestPayloadPreview
                      entityType={r.entityType}
                      entityRef={r.entityRef}
                      action={r.action}
                      payload={r.payload as Record<string, unknown>}
                    />
                  )}
                  {r.status === "REJECTED" && r.resolutionNote && (
                    <div className="mt-2 text-xs text-destructive">
                      Rejected by {r.resolvedByName ?? "approver"} · “{r.resolutionNote}”
                    </div>
                  )}
                  {r.status === "APPROVED" && r.resolvedByName && (
                    <div className="mt-2 text-xs text-success">
                      Approved by {r.resolvedByName}
                      {r.applied ? " · change applied" : ""}
                      {r.resolutionNote ? ` · “${r.resolutionNote}”` : ""}
                    </div>
                  )}
                  {r.status === "PENDING_CEO" && r.departmentApprovedByName && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      Forwarded by {r.departmentApprovedByName} · awaiting CEO
                    </div>
                  )}
                </div>
                <span
                  className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                  style={{ background: style.bg, color: style.color }}
                >
                  {style.label}
                </span>
              </div>
            );
          })}
        </div>
        <ListPagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          totalItems={pagination.totalItems}
          startIndex={pagination.startIndex}
          endIndex={pagination.endIndex}
          onPageChange={pagination.setPage}
        />
      </section>
    </div>
  );
}
