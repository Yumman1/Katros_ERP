"use client";

import { format } from "date-fns";
import { ListPagination } from "@/components/ui/list-pagination";
import { PageHeader } from "@/components/ui/page-header";
import { useListPagination } from "@/lib/use-list-pagination";
import { trpc } from "@/lib/trpc/client";

const pkrFormat = new Intl.NumberFormat("en-PK");

const KIND_LABELS: Record<string, string> = {
  SELL_RELEASE_TRADER: "Sell release — trader",
  SELL_RELEASE_CEO: "Sell release — CEO",
  INBOUND_OVER_TRADER: "Over-delivery — trader",
  INBOUND_OVER_CEO: "Over-delivery — CEO",
  TRADE_SETTLEMENT: "Direct settlement",
  VOUCHER: "Voucher",
  PAYMENT: "Payment",
};

function humanizeKind(kind: string): string {
  if (KIND_LABELS[kind]) return KIND_LABELS[kind];
  const words = kind.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default function FinanceRejectionsPage() {
  const { data: rows, isLoading } = trpc.policy.rejections.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const pagination = useListPagination(rows ?? []);

  return (
    <div className="kastros-desk-page">
      <PageHeader
        title="Rejections"
        subtitle="Every rejection across the sale flow — vouchers, payments, and release requests — with who rejected and why."
      />

      <div className="kastros-desk-scroll pb-6">
        {isLoading ? (
          <div className="py-12 text-center text-sm text-subtle">Loading rejections…</div>
        ) : !rows?.length ? (
          <div className="exec-empty">No rejections recorded yet.</div>
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
                {pagination.items.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{format(new Date(r.createdAt), "d MMM yyyy, HH:mm")}</td>
                    <td className="whitespace-nowrap">
                      <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-bold text-destructive">
                        {humanizeKind(r.kind)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap font-mono text-xs">{r.refLabel}</td>
                    <td className="whitespace-nowrap font-mono text-xs">{r.tradeRef ?? "—"}</td>
                    <td className="whitespace-nowrap">{r.counterpartyName ?? "—"}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">
                      {r.amountPkr != null ? `${pkrFormat.format(r.amountPkr)} PKR` : "—"}
                    </td>
                    <td className="whitespace-nowrap">
                      {r.rejectedBy}{" "}
                      <span className="text-[10px] uppercase tracking-wider text-subtle">({r.rejectedRole})</span>
                    </td>
                    <td className="max-w-[280px] truncate text-muted-foreground" title={r.reason}>
                      {r.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ListPagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              totalItems={pagination.totalItems}
              startIndex={pagination.startIndex}
              endIndex={pagination.endIndex}
              onPageChange={pagination.setPage}
            />
          </div>
        )}
      </div>
    </div>
  );
}
