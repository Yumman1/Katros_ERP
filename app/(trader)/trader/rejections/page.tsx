"use client";

import Link from "next/link";
import { useState } from "react";
import { format } from "date-fns";
import { PageHeader } from "@/components/ui/page-header";
import { ListPagination } from "@/components/ui/list-pagination";
import { trpc } from "@/lib/trpc/client";

const PAGE_SIZE = 25;

const KIND_LABELS: Record<string, string> = {
  SELL_RELEASE_TRADER: "Release on credit — trader",
  SELL_RELEASE_CEO: "Release on credit — CEO",
  INBOUND_OVER_TRADER: "Over-delivery — trader",
  INBOUND_OVER_CEO: "Over-delivery — CEO",
  TRADE_SETTLEMENT: "Direct settlement",
  VOUCHER: "Voucher",
  PAYMENT: "Payment",
};

function humanizeKind(kind: string) {
  return KIND_LABELS[kind] ?? kind;
}

function fmtPkr(v: number) {
  return `${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(v)} PKR`;
}

export default function TraderRejectionsPage() {
  const { data: rows, isLoading } = trpc.policy.rejections.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const [page, setPage] = useState(1);

  const all = rows ?? [];
  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const pageRows = all.slice(startIndex, startIndex + PAGE_SIZE);

  return (
    <div className="kastros-desk-page">
      <PageHeader
        title="Rejections"
        subtitle="Requests on your trades that were rejected — with the reason."
      />

      <div className="kastros-desk-scroll pb-6">
        {isLoading ? (
          <div className="rounded-xl border border-border bg-card px-6 py-12 text-center text-sm text-subtle">
            Loading rejections…
          </div>
        ) : all.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-6 py-12 text-center text-sm text-subtle">
            No rejections on your trades. When a release, voucher, or payment request on one of
            your trades is rejected, it shows up here with the reason.
          </div>
        ) : (
          <div className="kastros-table-wrap">
            <table className="kastros-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Kind</th>
                  <th>Ref</th>
                  <th>Trade</th>
                  <th>Counterparty</th>
                  <th className="text-right">Amount</th>
                  <th>Rejected by</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-xs text-subtle">
                      {format(new Date(r.createdAt), "dd MMM yyyy HH:mm")}
                    </td>
                    <td className="whitespace-nowrap text-xs font-medium text-foreground">
                      {humanizeKind(r.kind)}
                    </td>
                    <td className="whitespace-nowrap font-mono text-xs text-foreground">
                      {r.gatepassNo ?? r.voucherNo ?? r.refLabel}
                    </td>
                    <td className="whitespace-nowrap">
                      {r.tradeRef ? (
                        <Link
                          href={`/trader/trades/${encodeURIComponent(r.tradeRef)}`}
                          className="font-mono text-xs text-accent-secondary hover:underline"
                        >
                          {r.tradeRef}
                        </Link>
                      ) : (
                        <span className="text-xs text-subtle">—</span>
                      )}
                    </td>
                    <td className="max-w-[180px] truncate text-xs text-muted-foreground">
                      {r.counterpartyName ?? "—"}
                    </td>
                    <td className="whitespace-nowrap text-right text-xs tabular-nums text-foreground">
                      {r.amountPkr != null ? fmtPkr(r.amountPkr) : "—"}
                    </td>
                    <td className="whitespace-nowrap text-xs text-muted-foreground">
                      {r.rejectedBy}
                      <span className="ml-1 text-subtle">({r.rejectedRole})</span>
                    </td>
                    <td className="min-w-[220px] max-w-[360px] whitespace-normal break-words text-xs text-destructive">
                      {r.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ListPagination
              page={safePage}
              totalPages={totalPages}
              totalItems={all.length}
              startIndex={startIndex + 1}
              endIndex={Math.min(startIndex + PAGE_SIZE, all.length)}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>
    </div>
  );
}
