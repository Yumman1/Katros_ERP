"use client";

import { ListPagination } from "@/components/ui/list-pagination";
import { formatQtyWithUnit } from "@/lib/formatters/numbers";
import { executionWorkspacePath } from "@/lib/execution-routes";
import { useListPagination } from "@/lib/use-list-pagination";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

type ClosedContract = {
  tradeRef: string;
  counterpartyName: string;
  commodityCode: string;
  commodityName: string;
  incoterms: string;
  executionProfile: string;
  contractualQtyMt: number;
  receivedQtyMt: number;
  openQtyMt: number;
  quantityUnit: string;
  contractStatus: string;
  lockedAt: Date;
};

export function ClosedTradesSection({
  contracts,
  loading,
  compact,
  className,
}: {
  contracts: ClosedContract[];
  loading?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const closedContracts = contracts.filter((c) => c.contractStatus !== "Open");
  const pagination = useListPagination(closedContracts, {
    resetKey: closedContracts.length,
    pageSize: compact ? 6 : undefined,
  });

  return (
    <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-foreground/[0.02]", className)}>
      {!compact && (
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Closed Trades</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Contracts closed automatically when received qty exceeds contract + booked tolerance, or manually via trader fulfillment (CEO approved).
          </p>
        </div>
      )}
      <div className="min-h-0 flex-1 divide-y divide-border overflow-auto">
        {pagination.items.map((c) => {
          const pct = c.contractualQtyMt > 0 ? Math.min(c.receivedQtyMt / c.contractualQtyMt, 1) : 0;
          return (
            <div
              key={c.tradeRef}
              className={cn(
                "grid gap-2 px-4 md:grid-cols-[minmax(0,1fr)_180px_100px] md:items-center",
                compact ? "py-2" : "py-3",
              )}
            >
              <div className="min-w-0">
                <Link
                  href={executionWorkspacePath(c.tradeRef, c.executionProfile)}
                  className="font-mono text-xs font-bold text-brand hover:underline"
                >
                  {c.tradeRef}
                </Link>
                <div className="mt-0.5 truncate text-sm text-foreground">{c.counterpartyName}</div>
                <div className="text-xs text-muted-foreground">
                  {c.commodityCode} · {c.incoterms}
                </div>
                {!compact && (
                  <div className="mt-1 text-[10px] text-subtle">
                    Locked {new Date(c.lockedAt).toLocaleDateString()}
                  </div>
                )}
              </div>
              <div>
                <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
                  <span>{formatQtyWithUnit(c.receivedQtyMt, c.quantityUnit, 2)} fulfilled</span>
                  <span>{(pct * 100).toFixed(1)}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-foreground/[0.06]">
                  <div className="h-full rounded-full bg-success" style={{ width: `${pct * 100}%` }} />
                </div>
              </div>
              <div className="text-right">
                <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-bold uppercase text-success">
                  <CheckCircle2 className="h-3 w-3" />
                  Closed
                </span>
                {c.openQtyMt > 0 && (
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {formatQtyWithUnit(c.openQtyMt, c.quantityUnit, 2)} short
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {!loading && closedContracts.length === 0 && <ClosedTradesEmpty />}
      </div>
      <ListPagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.totalItems}
        startIndex={pagination.startIndex}
        endIndex={pagination.endIndex}
        onPageChange={pagination.setPage}
        className="shrink-0 px-3 py-2"
      />
    </section>
  );
}

function ClosedTradesEmpty() {
  return (
    <div className="flex flex-col items-center justify-center px-5 py-12 text-center">
      <CheckCircle2 className="mb-2 h-8 w-8 text-muted-foreground" />
      <p className="text-sm text-subtle">No closed trades yet</p>
    </div>
  );
}
