"use client";

import { useState } from "react";
import { AlertTriangle, MessageSquarePlus, Trash2, X } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { useTeam } from "@/lib/use-team";
import {
  canActOnDepartment,
  type ChangeRequestAction,
  type Department,
} from "@/lib/departments";

type Props = {
  department: Department;
  entityType: string;
  entityRef: string;
  entityLabel: string;
  /** Head-only direct delete handler (wired by the parent to the right mutation). */
  onDelete?: () => Promise<unknown> | void;
  deleting?: boolean;
  /** Optional compact rendering for tight table cells. */
  compact?: boolean;
};

/**
 * Per-entry actions. Department heads (and admins) get a direct Delete button;
 * regular team members get a "Request change" button that opens a modal to send
 * an edit/delete request with comments to their head of department.
 */
export function EntryActions({
  department,
  entityType,
  entityRef,
  entityLabel,
  onDelete,
  deleting,
  compact,
}: Props) {
  const { role, isHead } = useTeam();
  const isHeadHere = role != null && canActOnDepartment(role, isHead, department);
  const headCanDirectDelete =
    isHeadHere && onDelete && !(department === "TRADING" && entityType === "TRADE");

  const [modalOpen, setModalOpen] = useState(false);
  const [action, setAction] = useState<ChangeRequestAction>("DELETE");
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const submit = trpc.team.submitChangeRequest.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      setComment("");
    },
  });

  const btn = compact ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs";

  if (headCanDirectDelete) {
    return (
      <button
        type="button"
        disabled={deleting}
        onClick={() => {
          if (confirm(`Delete ${entityLabel}? This cannot be undone.`)) void onDelete();
        }}
        className={`inline-flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/10 font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-50 ${btn}`}
        title="Delete entry (head of department)"
      >
        <Trash2 className="h-3.5 w-3.5" />
        {deleting ? "Deleting…" : "Delete"}
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setSubmitted(false);
          setModalOpen(true);
        }}
        className={`inline-flex items-center gap-1 rounded-md border border-kastros-border bg-white/5 font-medium text-muted-foreground hover:bg-foreground/10 ${btn}`}
        title="Request the head of department to edit or delete this entry"
      >
        <MessageSquarePlus className="h-3.5 w-3.5" />
        Request change
      </button>

      {modalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-kastros-border bg-kastros-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Request a change</h3>
                <p className="mt-0.5 text-xs text-subtle">
                  Sent to your head of department for approval.
                </p>
              </div>
              <button type="button" onClick={() => setModalOpen(false)} className="text-subtle hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 rounded-lg border border-kastros-border bg-black/20 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-subtle">{entityType}</div>
              <div className="font-mono text-sm text-foreground">{entityLabel}</div>
            </div>

            {submitted ? (
              <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-300">
                Request sent to the head of department. You can track it under My requests or Approvals.
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="rounded-md border border-kastros-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-foreground/5"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-4">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Action requested</div>
                  <div className="flex gap-2">
                    {(["EDIT", "DELETE"] as ChangeRequestAction[]).map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => setAction(a)}
                        className={`flex-1 rounded-md border px-3 py-2 text-xs font-semibold ${
                          action === a
                            ? a === "DELETE"
                              ? "border-red-500/50 bg-red-500/15 text-red-300"
                              : "border-success/50 bg-success/15 text-success"
                            : "border-kastros-border text-muted-foreground hover:bg-foreground/5"
                        }`}
                      >
                        {a === "EDIT" ? "Edit / alter" : "Delete"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-3">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Comment for the head</div>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={3}
                    placeholder="Explain what is wrong and what should change…"
                    className="w-full rounded-md border border-kastros-border bg-black/20 px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:border-success focus:outline-none"
                  />
                </div>

                {submit.error && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-red-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {submit.error.message}
                  </div>
                )}

                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="rounded-md border border-kastros-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-foreground/5"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={submit.isPending || comment.trim().length === 0}
                    onClick={() =>
                      submit.mutate({
                        department,
                        entityType,
                        entityRef,
                        entityLabel,
                        action,
                        comment,
                      })
                    }
                    className="rounded-md bg-brand px-4 py-1.5 text-xs font-semibold text-kastros-bg hover:opacity-90 disabled:opacity-50"
                  >
                    {submit.isPending ? "Sending…" : "Send request"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
