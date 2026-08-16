"use client";

// NOTE: PLACEHOLDER until the official Kastros delivery order template is provided.

import type { SaleTruckPrintable } from "@/server/execution/sale-workflow";
import { cn } from "@/lib/utils";

const fmtKg = (n: number) =>
  `${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(n)} kg`;

const fmtDateTime = (d: Date | string) =>
  new Date(d).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });

/** Print CSS: hide the app shell and toolbar, print only the document. */
export const DELIVERY_ORDER_PRINT_CSS = `
@media print {
  .no-print { display: none !important; }
  body * { visibility: hidden !important; }
  .print-doc, .print-doc * { visibility: visible !important; }
  .print-doc {
    position: fixed !important;
    left: 0 !important;
    top: 0 !important;
    width: 100% !important;
    max-width: none !important;
    margin: 0 !important;
    box-shadow: none !important;
  }
}
`;

export function DeliveryOrderPrintStyles() {
  return <style>{DELIVERY_ORDER_PRINT_CSS}</style>;
}

function Field({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="mt-0.5 text-sm text-black">{value}</div>
    </div>
  );
}

type Props = {
  data: SaleTruckPrintable | undefined;
  isLoading?: boolean;
  error?: { message: string } | null;
  className?: string;
};

export function DeliveryOrderDocument({ data, isLoading, error, className }: Props) {
  if (isLoading) {
    return <p className={cn("p-8 text-sm text-neutral-600", className)}>Loading delivery order…</p>;
  }
  if (error) {
    return <p className={cn("p-8 text-sm text-red-700", className)}>{error.message}</p>;
  }
  if (data && !data.deliveryOrderNo) {
    return (
      <div className={cn("mx-auto max-w-[560px] p-10 text-center", className)}>
        <p className="text-base font-semibold text-black">Not issued yet</p>
        <p className="mt-1 text-sm text-neutral-600">
          Generate the delivery order from the truck workflow first.
        </p>
      </div>
    );
  }
  if (!data?.deliveryOrderNo) return null;

  return (
    <div
      className={cn(
        "print-doc mx-auto w-full max-w-[560px] border border-black bg-white p-6 text-black",
        className,
      )}
    >
      <div className="border-b-2 border-black pb-3 text-center">
        <div className="text-2xl font-bold uppercase tracking-[0.3em]">Kastros</div>
        <div className="mt-0.5 text-[11px] uppercase tracking-wider text-neutral-600">
          Agri-commodity trading · Pakistan
        </div>
        <div className="mt-3 text-lg font-bold uppercase tracking-[0.2em]">Delivery Order</div>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span>
          DO no: <span className="font-mono font-bold">{data.deliveryOrderNo}</span>
        </span>
        <span>Issued: {data.issuedAt ? fmtDateTime(data.issuedAt) : "—"}</span>
      </div>

      <p className="mt-4 border-t border-black/30 pt-4 text-sm italic">
        To the warehouse incharge, {data.warehouseName}: please deliver to bearer the goods
        described below, for and on account of <b>{data.buyerName}</b>.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3">
        <Field label="Buyer" value={data.buyerName} />
        <Field label="NTN" value={data.buyerNtn ?? "—"} />
        <Field
          label="Commodity"
          value={
            data.commodityName
              ? `${data.commodityName}${data.commodityCode ? ` (${data.commodityCode})` : ""}`
              : "—"
          }
        />
        <Field label="Gate weight" value={fmtKg(data.weightKg)} />
        <Field label="Warehouse" value={data.warehouseName} />
        <Field label="Truck no" value={data.truckNo} />
        <Field label="Trade ref" value={data.tradeRef ?? "—"} />
      </div>

      <div className="mt-8 border-t border-black/30 pt-4 text-center text-sm font-semibold uppercase tracking-wider">
        Approved By Kastros
      </div>
    </div>
  );
}
