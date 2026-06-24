"use client";

import { trpc } from "@/lib/trpc/client";
import Link from "next/link";
import { useState } from "react";
import { executionWorkspacePath } from "@/lib/execution-routes";

const fmtPKR = (n: number) =>
  "₨ " + new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(n);

const SOURCE_LABELS: Record<string, string> = {
  INBOUND: "Purchase (Delivered)",
  OUTBOUND: "Sale (Ex-WH)",
  SPOT: "Purchase (Spot)",
};
const SOURCE_COLORS: Record<string, string> = {
  INBOUND: "#34d399",
  OUTBOUND: "#a78bfa",
  SPOT: "#60a5fa",
};

export default function FinanceQueuePage() {
  const utils = trpc.useUtils();
  const { data: payments } = trpc.execution.paymentRequests.useQuery({});
  const approve = trpc.execution.approvePayment.useMutation({ onSuccess: () => utils.execution.paymentRequests.invalidate() });
  const reject = trpc.execution.rejectPayment.useMutation({ onSuccess: () => utils.execution.paymentRequests.invalidate() });

  const [comments, setComments] = useState<Record<string, string>>({});

  const pending = (payments ?? []).filter((p) => p.status === "PENDING");
  const resolved = (payments ?? []).filter((p) => p.status !== "PENDING");

  const totalPending = pending.reduce((a, p) => a + p.amount, 0);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-xs" style={{ color: "#71717a" }}>
          <Link href="/execution" className="hover:text-white">Desk</Link><span>/</span>
          <span style={{ color: "#a1a1aa" }}>Finance Queue</span>
        </div>
        <h1 className="mt-2 text-2xl font-bold text-white">Finance Queue</h1>
        <p className="mt-1 text-sm" style={{ color: "#71717a" }}>
          Payment requests awaiting finance approval. Approve to release goods / mark payment received.
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl p-4" style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)" }}>
          <div className="text-2xl font-bold tabular-nums" style={{ color: "#f87171" }}>{pending.length}</div>
          <div className="mt-0.5 text-xs uppercase tracking-wider" style={{ color: "#71717a" }}>Pending</div>
        </div>
        <div className="rounded-xl p-4" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}>
          <div className="text-lg font-bold" style={{ color: "#f59e0b" }}>{fmtPKR(totalPending)}</div>
          <div className="mt-0.5 text-xs uppercase tracking-wider" style={{ color: "#71717a" }}>Total Pending</div>
        </div>
        <div className="rounded-xl p-4" style={{ background: "rgba(52,211,153,0.06)", border: "1px solid rgba(52,211,153,0.12)" }}>
          <div className="text-2xl font-bold tabular-nums" style={{ color: "#34d399" }}>{resolved.filter((p) => p.status === "APPROVED").length}</div>
          <div className="mt-0.5 text-xs uppercase tracking-wider" style={{ color: "#71717a" }}>Approved</div>
        </div>
      </div>

      {/* Pending approvals */}
      {pending.length > 0 ? (
        <div className="rounded-2xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="border-b px-5 py-4" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <h2 className="text-sm font-semibold text-white">Pending Approval</h2>
            <p className="mt-0.5 text-xs" style={{ color: "#71717a" }}>Review and approve or reject each payment request below.</p>
          </div>
          <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
            {pending.map((p) => {
              const color = SOURCE_COLORS[p.sourceType] ?? "#6b7280";
              return (
                <div key={p.id} className="p-5 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-bold text-amber-400">{p.tradeRef}</span>
                        <span className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase"
                          style={{ background: `${color}18`, color }}>
                          {SOURCE_LABELS[p.sourceType] ?? p.sourceType}
                        </span>
                        <span className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase"
                          style={{ background: "rgba(248,113,113,0.1)", color: "#f87171" }}>
                          PENDING
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-medium text-white">{p.counterpartyName}</p>
                      <p className="mt-0.5 text-xs" style={{ color: "#71717a" }}>
                        Submitted {new Date(p.createdAt).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold tabular-nums" style={{ color: "#f59e0b" }}>{fmtPKR(p.amount)}</div>
                      <div className="text-xs" style={{ color: "#71717a" }}>{p.currency}</div>
                    </div>
                  </div>

                  {/* Finance comment + actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    <input placeholder="Finance comment (optional)"
                      value={comments[p.id] ?? ""}
                      onChange={(e) => setComments((s) => ({ ...s, [p.id]: e.target.value }))}
                      className="flex-1 min-w-[200px] rounded-lg px-3 py-1.5 text-xs text-white"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }} />
                    <button onClick={() => approve.mutate({ paymentId: p.id, comment: comments[p.id] })}
                      disabled={approve.isPending}
                      className="rounded-lg px-4 py-1.5 text-xs font-bold transition-all hover:opacity-90 disabled:opacity-50"
                      style={{ background: "rgba(52,211,153,0.15)", color: "#34d399", border: "1px solid rgba(52,211,153,0.3)" }}>
                      ✓ Approve
                    </button>
                    <button onClick={() => reject.mutate({ paymentId: p.id, comment: comments[p.id] })}
                      disabled={reject.isPending}
                      className="rounded-lg px-4 py-1.5 text-xs font-bold transition-all hover:opacity-90 disabled:opacity-50"
                      style={{ background: "rgba(248,113,113,0.1)", color: "#f87171", border: "1px solid rgba(248,113,113,0.25)" }}>
                      ✗ Reject
                    </button>
                    <Link href={executionWorkspacePath(p.tradeRef, p.sourceType === "INBOUND" ? "PURCHASE_DELIVERED" : p.sourceType === "SPOT" ? "PURCHASE_SPOT" : "SALE_EX_WAREHOUSE")}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium hover:underline"
                      style={{ color: "#71717a" }}>
                      View contract →
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center rounded-2xl"
          style={{ background: "rgba(52,211,153,0.04)", border: "1px solid rgba(52,211,153,0.1)" }}>
          <div className="mb-3 rounded-2xl p-4" style={{ background: "rgba(52,211,153,0.1)" }}>
            <svg className="h-8 w-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-green-400">Finance queue is clear</p>
          <p className="mt-1 text-xs" style={{ color: "#71717a" }}>No pending payment requests.</p>
        </div>
      )}

      {/* History */}
      {resolved.length > 0 && (
        <div className="rounded-2xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="border-b px-5 py-4" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <h2 className="text-sm font-semibold text-white">History</h2>
          </div>
          <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
            {resolved.map((p) => {
              const color = SOURCE_COLORS[p.sourceType] ?? "#6b7280";
              const statusColor = p.status === "APPROVED" ? "#34d399" : "#f87171";
              return (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <span className="font-mono font-semibold text-amber-400">{p.tradeRef}</span>
                    <span style={{ color }}>{SOURCE_LABELS[p.sourceType] ?? p.sourceType}</span>
                    <span className="text-zinc-300">{p.counterpartyName}</span>
                    <span className="tabular-nums" style={{ color: "#f59e0b" }}>{fmtPKR(p.amount)}</span>
                    {p.financeComment && <span style={{ color: "#71717a" }}>&ldquo;{p.financeComment}&rdquo;</span>}
                  </div>
                  <span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase"
                    style={{ background: `${statusColor}18`, color: statusColor }}>
                    {p.status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
