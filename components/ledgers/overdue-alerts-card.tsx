"use client";

import { AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const pkrFormat = new Intl.NumberFormat("en-PK");

const MAX_ROWS = 6;

/**
 * Overdue ledger-debit alerts — shared by the finance, CEO, trader and
 * execution dashboards. Self-fetching; renders nothing when there are no
 * overdue entries.
 */
export function OverdueAlertsCard({ title }: { title?: string }): JSX.Element | null {
  const { data: alerts } = trpc.policy.overdueLedgerAlerts.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: false,
  });

  if (!alerts?.length) return null;

  const severe = alerts.some((a) => a.agingBucket === "90+");
  const visible = alerts.slice(0, MAX_ROWS);
  const hidden = alerts.length - visible.length;

  return (
    <section
      className={cn(
        "exec-panel border",
        severe ? "border-destructive/40 bg-destructive/5" : "border-warning/40 bg-warning/5",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <AlertTriangle className={cn("h-4 w-4", severe ? "text-destructive" : "text-warning")} />
        <h2 className="text-sm font-semibold text-foreground">{title ?? "Overdue ledger entries"}</h2>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-bold",
            severe ? "bg-destructive/15 text-destructive" : "bg-warning/15 text-warning",
          )}
        >
          {alerts.length}
        </span>
      </div>

      <ul className="mt-2 space-y-1">
        {visible.map((a, i) => (
          <li
            key={`${a.ledgerAccountId}-${a.sourceRef ?? i}`}
            className="flex flex-wrap items-center gap-x-1.5 text-xs text-foreground"
          >
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase",
                a.side === "SELL" ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
              )}
            >
              {a.side === "SELL" ? "receivable" : "payable"}
            </span>
            <span className="font-medium">
              {a.counterpartyName}{" "}
              <span className="font-mono text-[10px] text-muted-foreground">({a.ledgerAccountId})</span>
            </span>
            <span className="text-subtle">·</span>
            <span className="font-mono">{a.sourceRef ?? "—"}</span>
            <span className="text-subtle">·</span>
            <span className="tabular-nums">{pkrFormat.format(a.amountPkr)} PKR</span>
            <span className="text-subtle">·</span>
            <span className={cn("font-semibold", a.agingBucket === "90+" ? "text-destructive" : "text-warning")}>
              overdue {a.overdueDays}d ({a.agingBucket})
            </span>
          </li>
        ))}
      </ul>
      {hidden > 0 && <p className="mt-1.5 text-xs text-subtle">+{hidden} more</p>}
    </section>
  );
}
