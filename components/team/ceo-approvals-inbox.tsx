"use client";

import { useMemo, useState } from "react";
import { Check, Inbox, ShieldCheck, X } from "lucide-react";
import { ListPagination } from "@/components/ui/list-pagination";
import { useListPagination } from "@/lib/use-list-pagination";
import { trpc } from "@/lib/trpc/client";
import { invalidateApprovalCaches } from "@/lib/invalidate-caches";
import { DEPARTMENT_LABELS, type ChangeRequestStatus } from "@/lib/departments";
import { ChangeRequestPayloadPreview } from "@/components/team/trade-edit-change-preview";

const STATUS_STYLE: Record<ChangeRequestStatus, { bg: string; color: string; label: string }> = {
  PENDING: { bg: "rgba(245,158,11,0.15)", color: "#fbbf24", label: "Pending head" },
  PENDING_CEO: { bg: "rgba(59,130,246,0.15)", color: "#60a5fa", label: "Awaiting CEO" },
  APPROVED: { bg: "rgba(16,185,129,0.15)", color: "#34d399", label: "Approved" },
  REJECTED: { bg: "rgba(239,68,68,0.15)", color: "#f87171", label: "Rejected" },
};

function fmt(d: Date | string) {
  return new Date(d).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function actionLabel(action: string, entityType: string): string {
  if (action === "CLOSE") return "Approve & close trade";
  if (action === "CREATE" && entityType === "WAREHOUSE") return "Approve & register warehouse";
  if (action === "CREATE" && entityType === "COMMODITY") return "Approve & register commodity";
  if (action === "CREATE") return "Approve & create";
  if (action === "DELETE" && entityType === "TRADE") return "Approve & delete trade";
  if (action === "EDIT" && entityType === "TRADE") return "Approve & apply trade changes";
  if (action === "DELETE") return "Approve & delete";
  return "Approve & apply";
}

export function CeoApprovalsInbox() {
  const utils = trpc.useUtils();
  const queue = trpc.ceo.approvalQueue.useQuery(undefined, { refetchInterval: 60_000, staleTime: 60_000 });
  const [notes, setNotes] = useState<Record<string, string>>({});

  const resolve = trpc.ceo.resolveApproval.useMutation({
    onSuccess: () => invalidateApprovalCaches(utils),
  });

  const items = useMemo(() => queue.data ?? [], [queue.data]);
  const pagination = useListPagination(items);

  return (
    <div className="kastros-desk-page">
      <div className="kastros-desk-toolbar">
        <h1 className="text-2xl font-semibold text-foreground">Approvals</h1>
        <p className="mt-1 text-sm text-subtle">
          Final sign-off on warehouse creation, commodity registration, trader trade edits and deletions, and manual
          trade closures requested by traders or execution.
        </p>
      </div>

      <div className="kastros-desk-scroll flex flex-col gap-6 pb-6">
      <section className="rounded-xl border border-kastros-border bg-kastros-card">
        <div className="flex items-center justify-between border-b border-kastros-border px-5 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldCheck className="h-4 w-4 text-brand" />
            CEO queue
          </div>
          <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning">
            {items.length} pending
          </span>
        </div>

        <div className="divide-y divide-kastros-border">
          {items.length === 0 && (
            <div className="flex items-center gap-2 px-5 py-8 text-sm text-subtle">
              <Inbox className="h-4 w-4" /> Nothing awaiting your approval.
            </div>
          )}
          {pagination.items.map((r) => {
            const style = STATUS_STYLE[r.status];
            return (
              <div key={r.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-subtle">{r.id}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                          r.action === "DELETE"
                            ? "bg-red-500/15 text-red-300"
                            : r.action === "CREATE"
                              ? "bg-emerald-500/15 text-emerald-300"
                              : r.action === "CLOSE"
                                ? "bg-violet-500/15 text-violet-300"
                                : "bg-sky-500/15 text-sky-300"
                        }`}
                      >
                        {r.action}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-subtle">
                        {DEPARTMENT_LABELS[r.department]} · {r.entityType}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-sm text-foreground">{r.entityLabel}</div>
                    <div className="mt-1 text-sm text-muted-foreground">“{r.comment}”</div>
                    <div className="mt-1 text-xs text-subtle">
                      {r.requestedByName} · {fmt(r.requestedAt)}
                    </div>
                    {r.departmentApprovedByName && (
                      <div className="mt-1 text-xs text-accent-secondary">
                        Execution head: {r.departmentApprovedByName}
                        {r.departmentApprovedAt ? ` · ${fmt(r.departmentApprovedAt)}` : ""}
                        {r.departmentApprovalNote ? ` · “${r.departmentApprovalNote}”` : ""}
                      </div>
                    )}
                    {r.payload && r.action !== "DELETE" && (
                      <ChangeRequestPayloadPreview
                        entityType={r.entityType}
                        entityRef={r.entityRef}
                        action={r.action}
                        payload={r.payload as Record<string, unknown>}
                        department={r.department}
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

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    value={notes[r.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                    placeholder="Optional note…"
                    className="min-w-0 flex-1 rounded-md border border-kastros-border bg-black/20 px-3 py-1.5 text-xs text-foreground placeholder:text-subtle focus:border-brand focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={resolve.isPending}
                    onClick={() => resolve.mutate({ id: r.id, decision: "APPROVED", note: notes[r.id] })}
                    className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-kastros-bg hover:opacity-90 disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" />
                    {actionLabel(r.action, r.entityType)}
                  </button>
                  <button
                    type="button"
                    disabled={resolve.isPending}
                    onClick={() => resolve.mutate({ id: r.id, decision: "REJECTED", note: notes[r.id] })}
                    className="inline-flex items-center gap-1 rounded-md border border-kastros-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-foreground/5 disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" />
                    Reject
                  </button>
                </div>
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
    </div>
  );
}
