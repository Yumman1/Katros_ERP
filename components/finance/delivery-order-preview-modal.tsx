"use client";

import { X } from "lucide-react";
import {
  DeliveryOrderDocument,
  DeliveryOrderPrintStyles,
} from "@/components/documents/delivery-order-document";
import { trpc } from "@/lib/trpc/client";

type Props = {
  truckId: string;
  deliveryOrderNo: string | null;
  open: boolean;
  onClose: () => void;
};

export function DeliveryOrderPreviewModal({ truckId, deliveryOrderNo, open, onClose }: Props) {
  const { data, isLoading, error } = trpc.execution.saleTruckPrintable.useQuery(
    { truckId },
    { enabled: open },
  );

  if (!open) return null;

  return (
    <div
      className="no-print fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={
        deliveryOrderNo ? `Delivery order ${deliveryOrderNo}` : "Delivery order preview"
      }
    >
      <DeliveryOrderPrintStyles />
      <div
        className="mb-8 w-full max-w-[640px] rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="no-print flex flex-wrap items-center gap-2 border-b border-black/10 px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-black">Delivery order preview</div>
            {deliveryOrderNo && (
              <div className="font-mono text-xs text-neutral-600">{deliveryOrderNo}</div>
            )}
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!data?.deliveryOrderNo}
            className="ml-auto rounded-md bg-black px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            Print
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium text-black hover:bg-black/5"
          >
            <X className="h-3.5 w-3.5" />
            Close
          </button>
        </div>
        <DeliveryOrderDocument
          data={data}
          isLoading={isLoading}
          error={error}
          className="my-6"
        />
      </div>
    </div>
  );
}
