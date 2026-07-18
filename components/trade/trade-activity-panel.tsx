"use client";

import { TradeEditChangePreview } from "@/components/team/trade-edit-change-preview";
import { trpc } from "@/lib/trpc/client";

const KIND_LABEL: Record<string, string> = {
  EDIT_APPLIED: "Edit applied",
  EDIT_REQUESTED: "Edit requested",
  EDIT_APPROVED: "Edit approved",
  EDIT_REJECTED: "Edit rejected",
  DELETE_REQUESTED: "Delete requested",
};

const SIDE_LABEL: Record<string, string> = {
  TRADER: "Trader",
  EXECUTION: "Execution",
  CEO: "CEO",
};

export function TradeActivityPanel({
  tradeRef,
  audience,
}: {
  tradeRef: string;
  audience: "trader" | "execution";
}) {
  const traderQuery = trpc.trader.tradeTimeline.useQuery(
    { tradeRef },
    { enabled: audience === "trader", staleTime: 30_000 },
  );
  const executionQuery = trpc.execution.tradeTimeline.useQuery(
    { tradeRef },
    { enabled: audience === "execution", staleTime: 30_000 },
  );
  const data = audience === "trader" ? traderQuery.data : executionQuery.data;
  const isLoading = audience === "trader" ? traderQuery.isLoading : executionQuery.isLoading;

  if (isLoading) {
    return <div className="animate-pulse text-sm text-subtle">Loading change history…</div>;
  }

  const activity = data?.activity ?? [];
  const pending = data?.pending ?? [];

  if (!activity.length && !pending.length) {
    return (
      <div className="rounded-lg border border-kastros-border bg-kastros-card p-4 text-sm text-subtle">
        No edits or approval requests recorded for this trade yet.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-kastros-border bg-kastros-card p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Change history</h2>
        <p className="mt-0.5 text-xs text-subtle">
          Edits and approval requests from trader and execution — visible on both desks.
        </p>
      </div>

      {pending.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-warning">Pending approval</div>
          {pending.map((r) => (
            <div
              key={r.id}
              className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] text-subtle">{r.id}</span>
                <span className="rounded bg-warning/20 px-1.5 py-0.5 font-semibold uppercase text-warning">
                  {r.action}
                </span>
                <span className="text-subtle">
                  {SIDE_LABEL[r.department === "TRADING" ? "TRADER" : "EXECUTION"] ?? r.department}
                  {r.status === "PENDING_CEO" ? " → CEO" : " → head"}
                </span>
              </div>
              <div className="mt-1 text-muted-foreground">“{r.comment}”</div>
              <div className="mt-1 text-subtle">
                {r.requestedByName} · {new Date(r.requestedAt).toLocaleString()}
              </div>
              {r.payload && r.action === "EDIT" && (
                <TradeEditChangePreview
                  tradeRef={tradeRef}
                  payload={r.payload as Record<string, unknown>}
                  compact
                  useCeoLookup={r.department === "TRADING"}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {activity.length > 0 && (
        <div className="divide-y divide-kastros-border/60">
          {activity.map((entry) => (
            <div key={entry.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-foreground">
                  {KIND_LABEL[entry.kind] ?? entry.kind}
                </span>
                <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] uppercase text-subtle">
                  {SIDE_LABEL[entry.actorSide] ?? entry.actorSide}
                </span>
                {entry.requiresApproval && (
                  <span className="text-[10px] text-warning">via approval</span>
                )}
                <span className="text-subtle">{new Date(entry.at).toLocaleString()}</span>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">{entry.summary}</div>
              {entry.note && <div className="mt-1 text-xs text-subtle">“{entry.note}”</div>}
              <div className="mt-0.5 text-[11px] text-subtle">by {entry.actorName}</div>
              {entry.payload && entry.kind.includes("EDIT") && (
                <TradeEditChangePreview
                  tradeRef={tradeRef}
                  payload={entry.payload as Record<string, unknown>}
                  compact
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
