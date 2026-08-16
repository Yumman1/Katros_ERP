"use client";

import Link from "next/link";
import { useState } from "react";
import { DeliveryOrderPreviewModal } from "@/components/finance/delivery-order-preview-modal";
import { invalidateFinanceApprovalBadges } from "@/lib/invalidate-caches";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/components/ui/page-header";
import { formatPkDateTime } from "@/lib/formatters/datetime";

const fmtPkr = (n: number | null) =>
  n != null ? `${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(n)} PKR` : "—";

export default function FinanceDoApprovalsPage() {
  const utils = trpc.useUtils();
  const [previewTruckId, setPreviewTruckId] = useState<string | null>(null);
  const [previewDoNo, setPreviewDoNo] = useState<string | null>(null);
  const { data: rows, isLoading } = trpc.finance.doApprovals.useQuery(undefined, {
    refetchInterval: 20_000,
  });
  const approve = trpc.finance.approveDo.useMutation({
    onSuccess: () => {
      invalidateFinanceApprovalBadges(utils);
      void utils.finance.doApprovals.invalidate();
      void utils.execution.saleWorkflowRows.invalidate();
    },
  });

  const openPreview = (truckId: string, deliveryOrderNo: string | null) => {
    setPreviewTruckId(truckId);
    setPreviewDoNo(deliveryOrderNo);
  };

  const closePreview = () => {
    setPreviewTruckId(null);
    setPreviewDoNo(null);
  };

  return (
    <div className="kastros-desk-page">
      <PageHeader
        breadcrumb={
          <>
            <Link href="/finance/payments" className="hover:text-foreground">
              Finance
            </Link>
            <span>/</span>
            <span className="text-muted-foreground">Delivery order approvals</span>
          </>
        }
        title="Delivery order approvals"
        subtitle="Final finance sign-off on delivery orders. After approval, execution can generate the gate pass."
        actions={
          rows && rows.length > 0 ? (
            <span className="rounded-full bg-warning/15 px-2.5 py-1 text-xs font-bold text-warning">
              {rows.length} pending
            </span>
          ) : undefined
        }
      />
      <div className="kastros-desk-scroll">
        {isLoading ? (
          <p className="text-sm text-subtle">Loading…</p>
        ) : !rows?.length ? (
          <p className="text-sm text-subtle">No delivery orders awaiting finance approval.</p>
        ) : (
          <div className="kastros-table-wrap">
            <table className="kastros-table text-xs">
              <thead>
                <tr>
                  {["DO", "Gatepass", "Buyer", "Warehouse", "Trade", "Receivable", "Arrival", ""].map(
                    (h) => (
                      <th key={h} className="px-4">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.truckId}>
                    <td className="px-4 font-mono font-semibold">{r.deliveryOrderNo ?? "—"}</td>
                    <td className="px-4 font-mono">{r.gatepassNo}</td>
                    <td className="px-4">{r.counterpartyName}</td>
                    <td className="px-4">{r.warehouseName}</td>
                    <td className="px-4 font-mono">{r.tradeRef ?? "—"}</td>
                    <td className="px-4 tabular-nums">{fmtPkr(r.saleExpectedPkr)}</td>
                    <td className="px-4 whitespace-nowrap">{formatPkDateTime(r.arrivalDate)}</td>
                    <td className="px-4">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openPreview(r.truckId, r.deliveryOrderNo)}
                          className="text-accent-secondary hover:underline"
                        >
                          Preview
                        </button>
                        <button
                          type="button"
                          disabled={approve.isPending}
                          onClick={() => approve.mutate({ truckId: r.truckId })}
                          className="kastros-btn-primary px-3 py-1 text-[11px] disabled:opacity-50"
                        >
                          Approve
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {previewTruckId && (
        <DeliveryOrderPreviewModal
          truckId={previewTruckId}
          deliveryOrderNo={previewDoNo}
          open={Boolean(previewTruckId)}
          onClose={closePreview}
        />
      )}
    </div>
  );
}
