"use client";

import Link from "next/link";
import { format } from "date-fns";
import { CheckCircle2, PenLine } from "lucide-react";
import { formatQty } from "@/lib/formatters/numbers";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const MY_REQUEST_STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-warning/15 text-warning",
  PENDING_CEO: "bg-sky-500/15 text-sky-400",
  APPROVED: "bg-success/15 text-success",
  REJECTED: "bg-destructive/15 text-destructive",
};

/** deliveryEnd → "Delivery end" */
function humanizeKey(key: string) {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function stringifyValue(value: unknown): string {
  if (value == null) return "—";
  if (value instanceof Date) return format(value, "dd MMM yyyy");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function TraderApprovalsPage() {
  const utils = trpc.useUtils();
  const { data: rows, isLoading } = trpc.trader.executionEditApprovals.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const myRequests = trpc.team.myChangeRequests.useQuery();

  const approve = trpc.trader.approveExecutionEdits.useMutation({
    onSuccess: (_data, variables) => {
      void utils.trader.executionEditApprovals.invalidate();
      void utils.trader.executionEditApprovalsCount.invalidate();
      void utils.trader.myTrades.invalidate();
      void utils.trader.tradeByRef.invalidate({ tradeRef: variables.tradeRef });
    },
  });

  // Page shell, header and tabs come from the layout — this renders one tab.
  return (
      <div className="kastros-desk-scroll space-y-6 pb-6">
        <p className="text-xs text-subtle">
          Execution&apos;s changes to your trades. Approving lets execution lock the trade.
        </p>
        {isLoading ? (
          <div className="py-12 text-center text-sm text-subtle">Loading approvals…</div>
        ) : !rows?.length ? (
          <div className="rounded-xl border border-border bg-card px-6 py-12 text-center text-sm text-subtle">
            No execution changes awaiting your approval.
          </div>
        ) : (
          <div className="space-y-4">
            {rows.map((row) => {
              const busy = approve.isPending && approve.variables?.tradeRef === row.tradeRef;
              const errorHere = approve.error && approve.variables?.tradeRef === row.tradeRef;
              const changeEntries = row.changes
                ? Object.entries(row.changes).filter(
                    ([key, value]) => key !== "executionEditNote" && value != null,
                  )
                : [];
              return (
                <article key={row.tradeRef} className="rounded-xl border border-border bg-card p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/trader/trades/${encodeURIComponent(row.tradeRef)}`}
                        className="font-mono text-lg font-semibold text-accent-secondary hover:underline"
                      >
                        {row.tradeRef}
                      </Link>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        <span
                          className={cn(
                            "font-medium",
                            row.direction === "BUY" ? "text-success" : "text-kastros-red",
                          )}
                        >
                          {row.direction}
                        </span>{" "}
                        · {row.commodityCode} — {row.commodityName} · {row.counterpartyName} ·{" "}
                        {formatQty(row.quantity)} {row.quantityUnit}
                      </p>
                      <p className="mt-1 text-xs text-subtle">
                        Edited by {row.editedBy ?? "execution"}
                        {row.editedAt ? ` · ${format(new Date(row.editedAt), "dd MMM yyyy HH:mm")}` : ""}
                        {row.changeCount != null
                          ? ` · ${row.changeCount} field${row.changeCount === 1 ? "" : "s"} changed`
                          : ""}
                      </p>
                      {row.editNote && (
                        <p className="mt-1 text-xs italic text-muted-foreground">“{row.editNote}”</p>
                      )}
                    </div>
                    <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-[10px] font-bold uppercase text-warning">
                      Awaiting your approval
                    </span>
                  </div>

                  {(row.changeSummary || changeEntries.length > 0) && (
                    <div className="mt-4 rounded-lg border border-kastros-border/70 bg-kastros-bg/40 px-4 py-3">
                      {row.changeSummary && (
                        <p className="text-sm font-medium text-foreground">{row.changeSummary}</p>
                      )}
                      {changeEntries.length > 0 && (
                        <dl
                          className={cn(
                            "grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs",
                            row.changeSummary && "mt-2",
                          )}
                        >
                          {changeEntries.map(([key, value]) => (
                            <div key={key} className="contents">
                              <dt className="text-subtle">{humanizeKey(key)}</dt>
                              <dd className="min-w-0 break-words font-medium text-foreground">
                                {stringifyValue(value)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => approve.mutate({ tradeRef: row.tradeRef })}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-success px-4 py-2 text-xs font-bold text-white hover:bg-success/90 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {busy ? "Approving…" : "Approve changes"}
                    </button>
                    <Link
                      href={`/trader/trades/${encodeURIComponent(row.tradeRef)}`}
                      className="kastros-btn-secondary text-xs"
                    >
                      Open trade
                    </Link>
                  </div>
                  {errorHere && <p className="mt-2 text-xs text-destructive">{approve.error?.message}</p>}
                </article>
              );
            })}
          </div>
        )}

        {/* Requests this trader submitted (e.g. new commodity registrations). */}
        {myRequests.data && myRequests.data.length > 0 && (
          <section>
            <div className="mb-2 flex items-center gap-2">
              <PenLine className="h-4 w-4 text-subtle" />
              <h2 className="text-sm font-semibold text-foreground">My change requests</h2>
            </div>
            <div className="divide-y divide-kastros-border rounded-xl border border-border bg-card">
              {myRequests.data.map((r) => (
                <div key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-subtle">{r.id}</span>
                      <span className="text-[10px] uppercase tracking-wider text-subtle">
                        {r.action} · {r.entityType}
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono text-sm text-foreground">{r.entityLabel}</div>
                    <div className="text-xs text-subtle">“{r.comment}”</div>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                      MY_REQUEST_STATUS_STYLE[r.status] ?? "bg-foreground/[0.08] text-subtle",
                    )}
                  >
                    {r.status.replace(/_/g, " ")}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
  );
}
