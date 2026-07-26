"use client";

import { trpc } from "@/lib/trpc/client";
import { formatQty } from "@/lib/formatters/numbers";
import { cn } from "@/lib/utils";
import { CheckCircle2, FileText, Wallet } from "lucide-react";
import Link from "next/link";

const fmtPkr = (n: number) =>
  `${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(n)} PKR`;

/** Collection progress bar — collected against the full trade amount. */
function ProgressBar({ pct, closed }: { pct: number; closed: boolean }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
      <div
        className={cn("h-full rounded-full transition-all", closed ? "bg-success" : "bg-brand")}
        style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }}
      />
    </div>
  );
}

/**
 * Settled trades — delivery cancelled, so no inventory and no truck ever runs.
 * The money still comes in: settlement invoices raise the receivable, vouchers
 * collect it, and the trade closes once the ledger holds the whole amount.
 */
export function SettledTradesSection() {
  const { data: rows, isLoading } = trpc.trader.settledTrades.useQuery();

  if (isLoading) return <div className="text-subtle">Loading settled trades…</div>;

  if (!rows?.length) {
    return (
      <div className="rounded-xl border border-kastros-border bg-kastros-card px-6 py-10 text-center text-sm text-subtle">
        No settled trades. A trade settled directly (CEO-approved, no delivery) appears here while
        its amount is collected through invoices and vouchers.
      </div>
    );
  }

  const collecting = rows.filter((r) => !r.isClosed);
  const totalOutstanding = collecting.reduce((s, r) => s + r.outstandingPkr, 0);

  return (
    <div className="space-y-3">
      {collecting.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-kastros-border bg-kastros-card px-4 py-3 text-xs">
          <span className="text-subtle">
            Collecting on <span className="text-foreground">{collecting.length}</span>{" "}
            {collecting.length === 1 ? "trade" : "trades"}
          </span>
          <span className="text-subtle">
            Still to collect{" "}
            <span className="font-mono font-semibold text-warning">{fmtPkr(totalOutstanding)}</span>
          </span>
        </div>
      )}

      {rows.map((r) => (
        <article
          key={r.tradeRef}
          className="rounded-xl border border-kastros-border bg-kastros-card px-4 py-3"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/trader/trades/${encodeURIComponent(r.tradeRef)}/settlement`}
                  className="font-mono text-sm font-semibold text-success hover:underline"
                >
                  {r.tradeRef}
                </Link>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                    r.direction === "BUY"
                      ? "bg-success/15 text-success"
                      : "bg-kastros-red/15 text-kastros-red",
                  )}
                >
                  {r.direction}
                </span>
                {r.isClosed ? (
                  <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-success/15 text-success">
                    <CheckCircle2 className="h-3 w-3" />
                    Closed
                  </span>
                ) : (
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-warning/20 text-warning">
                    Collecting
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-subtle">
                {r.commodityCode} · {formatQty(r.quantity)} {r.quantityUnit} · {r.counterpartyName}
              </div>
            </div>
            <Link
              href={`/trader/trades/${encodeURIComponent(r.tradeRef)}/settlement`}
              className="rounded-md border border-kastros-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-foreground/5"
            >
              {r.isClosed ? "View settlement" : "Manage settlement"}
            </Link>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <div>
              <div className="text-[10px] uppercase text-subtle">Trade amount</div>
              <div className="font-mono text-sm text-foreground">{fmtPkr(r.targetPkr)}</div>
            </div>
            <div>
              <div className="flex items-center gap-1 text-[10px] uppercase text-subtle">
                <FileText className="h-3 w-3" />
                Invoiced ({r.invoiceCount})
              </div>
              <div className="font-mono text-sm text-foreground">{fmtPkr(r.invoicedPkr)}</div>
            </div>
            <div>
              <div className="flex items-center gap-1 text-[10px] uppercase text-subtle">
                <Wallet className="h-3 w-3" />
                In ledger
              </div>
              <div className="font-mono text-sm text-success">{fmtPkr(r.collectedPkr)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-subtle">Outstanding</div>
              <div
                className={cn(
                  "font-mono text-sm",
                  r.outstandingPkr > 0 ? "text-warning" : "text-success",
                )}
              >
                {fmtPkr(r.outstandingPkr)}
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <ProgressBar pct={r.progressPct} closed={r.isClosed} />
            <span className="shrink-0 font-mono text-[11px] text-subtle">{r.progressPct}%</span>
          </div>
        </article>
      ))}
    </div>
  );
}
