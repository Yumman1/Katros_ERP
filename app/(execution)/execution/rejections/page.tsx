"use client";

import { XCircle } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";
import { ListPagination } from "@/components/ui/list-pagination";
import { DESK_REFETCH_MS } from "@/lib/invalidate-caches";
import { trpc } from "@/lib/trpc/client";
import { useListPagination } from "@/lib/use-list-pagination";

const fmtPkr = (n: number) =>
  `${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(n)} PKR`;

const fmtDateTime = (d: Date | string) =>
  new Date(d).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });

const KIND_LABELS: Record<string, string> = {
  SELL_RELEASE_TRADER: "Release request (trader)",
  SELL_RELEASE_CEO: "Release request (CEO)",
  INBOUND_OVER_TRADER: "Over-delivery — trader",
  INBOUND_OVER_CEO: "Over-delivery — CEO",
  TRADE_SETTLEMENT: "Direct settlement",
  VOUCHER: "Voucher",
  PAYMENT: "Payment",
};

/** SELL_RELEASE_TRADER → "Release request (trader)"; unknown kinds fall back to Title case. */
function humanizeKind(kind: string): string {
  if (kind in KIND_LABELS) return KIND_LABELS[kind];
  const words = kind.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default function ExecutionRejectionsPage() {
  const { data: rejections, isLoading } = trpc.policy.rejections.useQuery(undefined, {
    refetchInterval: DESK_REFETCH_MS,
  });

  const pagination = useListPagination(rejections ?? []);

  if (isLoading && !rejections) {
    return (
      <div className="kastros-desk-page">
        <PageLoadingSkeleton label="Loading rejections…" rows={8} />
      </div>
    );
  }

  return (
    <div className="kastros-desk-page">
      <PageHeader
        breadcrumb={
          <>
            <Link href="/execution" className="hover:text-foreground">
              Desk
            </Link>
            <span>/</span>
            <span className="text-muted-foreground">Rejections</span>
          </>
        }
        title="Rejections"
        subtitle="Rejected release requests, vouchers and payments — with reasons."
      />

      <div className="kastros-desk-scroll flex flex-col gap-4">
        <div className="kastros-table-wrap">
          <table className="kastros-table text-xs">
            <thead>
              <tr>
                {[
                  "Date",
                  "Kind",
                  "Ref",
                  "Trade",
                  "Counterparty",
                  "Amount",
                  "Rejected by",
                  "Reason",
                ].map((h) => (
                  <th key={h} className="px-5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagination.items.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                    {fmtDateTime(r.createdAt)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-foreground">
                    {humanizeKind(r.kind)}
                  </td>
                  <td className="px-5 py-3">
                    <span className="font-mono font-semibold text-foreground">{r.refLabel}</span>
                    {r.gatepassNo && r.gatepassNo !== r.refLabel && (
                      <div className="font-mono text-subtle">{r.gatepassNo}</div>
                    )}
                    {r.voucherNo && r.voucherNo !== r.refLabel && (
                      <div className="font-mono text-subtle">{r.voucherNo}</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 font-mono text-muted-foreground">
                    {r.tradeRef ?? "—"}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{r.counterpartyName ?? "—"}</td>
                  <td className="whitespace-nowrap px-5 py-3 font-mono font-semibold tabular-nums text-foreground">
                    {r.amountPkr != null ? fmtPkr(r.amountPkr) : "—"}
                  </td>
                  <td className="px-5 py-3">
                    <div className="text-foreground">{r.rejectedBy}</div>
                    <div className="text-[10px] uppercase tracking-wider text-subtle">
                      {r.rejectedRole}
                    </div>
                  </td>
                  <td className="max-w-[280px] px-5 py-3">
                    <span className="block truncate text-destructive" title={r.reason}>
                      {r.reason}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(rejections ?? []).length === 0 && (
            <div className="flex flex-col items-center justify-center px-5 py-12 text-center">
              <XCircle className="mb-2 h-8 w-8 text-subtle" />
              <p className="text-sm text-subtle">No rejections recorded yet</p>
            </div>
          )}
        </div>
        <ListPagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          totalItems={pagination.totalItems}
          startIndex={pagination.startIndex}
          endIndex={pagination.endIndex}
          onPageChange={pagination.setPage}
        />
      </div>
    </div>
  );
}
