"use client";

import { useMemo, useState } from "react";
import { Check, Clock, Inbox, ShieldCheck, X } from "lucide-react";
import { ListPagination } from "@/components/ui/list-pagination";
import { useListPagination } from "@/lib/use-list-pagination";
import { trpc } from "@/lib/trpc/client";
import { useTeam } from "@/lib/use-team";
import { invalidateApprovalCaches } from "@/lib/invalidate-caches";
import {
  canActOnDepartment,
  DEPARTMENT_LABELS,
  type ChangeRequestStatus,
  type Department,
} from "@/lib/departments";
import { ChangeRequestPayloadPreview } from "@/components/team/trade-edit-change-preview";
import { formatPkDateTime } from "@/lib/formatters/datetime";

const STATUS_STYLE: Record<ChangeRequestStatus, { bg: string; color: string; label: string }> = {
  PENDING: { bg: "rgba(245,158,11,0.15)", color: "#fbbf24", label: "Pending" },
  PENDING_CEO: { bg: "rgba(59,130,246,0.15)", color: "#60a5fa", label: "Awaiting CEO" },
  APPROVED: { bg: "rgba(16,185,129,0.15)", color: "#34d399", label: "Approved" },
  REJECTED: { bg: "rgba(239,68,68,0.15)", color: "#f87171", label: "Rejected" },
};

function fmt(d: Date | string) {
  return formatPkDateTime(d);
}

export function ChangeRequestsInbox({
  department,
  title = "Change requests",
  subtitle,
}: {
  department: Department;
  title?: string;
  subtitle?: string;
}) {
  const { role, isHead } = useTeam();
  const isHeadHere = role != null && canActOnDepartment(role, isHead, department);
  const utils = trpc.useUtils();

  const queue = trpc.team.changeRequests.useQuery(
    { department },
    { enabled: isHeadHere },
  );
  const mine = trpc.team.myChangeRequests.useQuery();

  const [notes, setNotes] = useState<Record<string, string>>({});
  const resolve = trpc.team.resolveChangeRequest.useMutation({
    onSuccess: () => invalidateApprovalCaches(utils),
  });

  const pendingCount = queue.data?.filter((r) => r.status === "PENDING").length ?? 0;
  const queueItems = useMemo(() => queue.data ?? [], [queue.data]);
  const mineItems = useMemo(() => mine.data ?? [], [mine.data]);
  const queuePagination = useListPagination(queueItems);
  const minePagination = useListPagination(mineItems);

  return (
    <div className="kastros-desk-page">
      <div className="kastros-desk-toolbar">
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        <p className="mt-1 text-sm text-subtle">
          {subtitle ?? `${DEPARTMENT_LABELS[department]} desk · edit and delete approvals.`}
        </p>
      </div>

      <div className="kastros-desk-scroll flex flex-col gap-6">
      {isHeadHere && (
        <section className="rounded-xl border border-kastros-border bg-kastros-card">
          <div className="flex items-center justify-between border-b border-kastros-border px-5 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ShieldCheck className="h-4 w-4 text-success" />
              Team queue
            </div>
            <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning">
              {pendingCount} pending
            </span>
          </div>

          <div className="divide-y divide-kastros-border">
            {queue.data?.length === 0 && (
              <div className="flex items-center gap-2 px-5 py-8 text-sm text-subtle">
                <Inbox className="h-4 w-4" /> No change requests from your team.
              </div>
            )}
            {queuePagination.items.map((r) => {
              const style = STATUS_STYLE[r.status];
              return (
                <div key={r.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-subtle">{r.id}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                            r.action === "DELETE"
                              ? "bg-red-500/15 text-red-300"
                              : r.action === "CREATE"
                                ? "bg-emerald-500/15 text-emerald-300"
                                : "bg-sky-500/15 text-sky-300"
                          }`}
                        >
                          {r.action}
                        </span>
                        <span className="text-[10px] uppercase tracking-wider text-subtle">{r.entityType}</span>
                      </div>
                      <div className="mt-1 font-mono text-sm text-foreground">{r.entityLabel}</div>
                      <div className="mt-1 text-sm text-muted-foreground">“{r.comment}”</div>
                      <div className="mt-1 text-xs text-subtle">
                        {r.requestedByName} · {fmt(r.requestedAt)}
                      </div>
                      {r.payload && r.action !== "DELETE" && (
                        <ChangeRequestPayloadPreview
                          entityType={r.entityType}
                          entityRef={r.entityRef}
                          action={r.action}
                          payload={r.payload as Record<string, unknown>}
                        />
                      )}
                      {r.status !== "PENDING" && (
                        <div className="mt-1 text-xs" style={{ color: style.color }}>
                          {style.label} by {r.resolvedByName}
                          {r.applied ? " · change applied" : ""}
                          {r.resolutionNote ? ` · “${r.resolutionNote}”` : ""}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                        style={{ background: style.bg, color: style.color }}
                      >
                        {style.label}
                      </span>
                    </div>
                  </div>

                  {r.status === "PENDING" && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <input
                        value={notes[r.id] ?? ""}
                        onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                        placeholder="Optional note…"
                        className="min-w-0 flex-1 rounded-md border border-kastros-border bg-black/20 px-3 py-1.5 text-xs text-foreground placeholder:text-subtle focus:border-success focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={resolve.isPending}
                        onClick={() =>
                          resolve.mutate({ id: r.id, decision: "APPROVED", note: notes[r.id] })
                        }
                        className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-kastros-bg hover:opacity-90 disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" />
                        {r.action === "DELETE"
                          ? "Approve & delete"
                          : r.action === "CREATE" && r.entityType === "WAREHOUSE"
                            ? "Forward to CEO"
                            : r.action === "CREATE"
                              ? "Approve & create"
                              : "Approve & apply"}
                      </button>
                      <button
                        type="button"
                        disabled={resolve.isPending}
                        onClick={() =>
                          resolve.mutate({ id: r.id, decision: "REJECTED", note: notes[r.id] })
                        }
                        className="inline-flex items-center gap-1 rounded-md border border-kastros-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-foreground/5 disabled:opacity-50"
                      >
                        <X className="h-3.5 w-3.5" />
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <ListPagination
            page={queuePagination.page}
            totalPages={queuePagination.totalPages}
            totalItems={queuePagination.totalItems}
            startIndex={queuePagination.startIndex}
            endIndex={queuePagination.endIndex}
            onPageChange={queuePagination.setPage}
          />
        </section>
      )}

      <section className="rounded-xl border border-kastros-border bg-kastros-card">
        <div className="flex items-center gap-2 border-b border-kastros-border px-5 py-3 text-sm font-semibold text-foreground">
          <Clock className="h-4 w-4 text-muted-foreground" />
          My requests
        </div>
        <div className="divide-y divide-kastros-border">
          {mine.data?.length === 0 && (
            <div className="px-5 py-8 text-sm text-subtle">You haven&apos;t raised any change requests.</div>
          )}
          {minePagination.items.map((r) => {
            const style = STATUS_STYLE[r.status];
            return (
              <div key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-subtle">{r.id}</span>
                    <span className="text-[10px] uppercase tracking-wider text-subtle">
                      {r.action} · {r.entityType}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-sm text-foreground">{r.entityLabel}</div>
                  <div className="text-xs text-subtle">“{r.comment}”</div>
                  {r.payload && r.action === "EDIT" && (
                    <ChangeRequestPayloadPreview
                      entityType={r.entityType}
                      entityRef={r.entityRef}
                      action={r.action}
                      payload={r.payload as Record<string, unknown>}
                    />
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
          page={minePagination.page}
          totalPages={minePagination.totalPages}
          totalItems={minePagination.totalItems}
          startIndex={minePagination.startIndex}
          endIndex={minePagination.endIndex}
          onPageChange={minePagination.setPage}
        />
      </section>
      </div>
    </div>
  );
}
