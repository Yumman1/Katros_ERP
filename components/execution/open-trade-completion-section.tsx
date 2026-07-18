"use client";

import { ListPagination } from "@/components/ui/list-pagination";
import { formatQtyWithUnit } from "@/lib/formatters/numbers";
import { executionWorkspacePath } from "@/lib/execution-routes";
import { useListPagination } from "@/lib/use-list-pagination";
import Link from "next/link";
import { Truck } from "lucide-react";

type OpenContract = {
  tradeRef: string;
  counterpartyName: string;
  commodityCode: string;
  incoterms: string;
  executionProfile: string;
  contractualQtyMt: number;
  receivedQtyMt: number;
  openQtyMt: number;
  quantityUnit: string;
  contractStatus: string;
};

export function OpenTradeCompletionSection({
  contracts,
  loading,
}: {
  contracts: OpenContract[];
  loading?: boolean;
}) {
  const openContracts = contracts.filter((c) => c.contractStatus === "Open");
  const pagination = useListPagination(openContracts, { resetKey: openContracts.length });

  return (
    <section className="rounded-2xl border border-border bg-foreground/[0.02]">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">Open Trade Completion</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Locked trades close automatically as linked trucks are received or released.
        </p>
      </div>
      <div className="divide-y divide-border">
        {pagination.items.map((c) => {
          const pct = c.contractualQtyMt > 0 ? Math.min(c.receivedQtyMt / c.contractualQtyMt, 1) : 0;
          return (
            <div
              key={c.tradeRef}
              className="grid gap-3 px-5 py-3 md:grid-cols-[minmax(0,1fr)_240px_120px] md:items-center"
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
              </div>
              <div>
                <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
                  <span>{formatQtyWithUnit(c.receivedQtyMt, c.quantityUnit, 2)} moved</span>
                  <span>{(pct * 100).toFixed(1)}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-foreground/[0.06]">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${pct * 100}%` }} />
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold text-foreground">
                  {formatQtyWithUnit(c.openQtyMt, c.quantityUnit, 2)}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">remaining</div>
              </div>
            </div>
          );
        })}
        {!loading && openContracts.length === 0 && <OpenTradeCompletionEmpty />}
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
  );
}

function OpenTradeCompletionEmpty() {
  return (
    <div className="flex flex-col items-center justify-center px-5 py-12 text-center">
      <Truck className="mb-2 h-8 w-8 text-muted-foreground" />
      <p className="text-sm text-subtle">No open locked trades</p>
    </div>
  );
}
