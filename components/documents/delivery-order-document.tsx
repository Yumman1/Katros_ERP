"use client";

import type { SaleTruckPrintable } from "@/server/execution/sale-workflow";
import { KASTROS_COMPANY_ADDRESS } from "@/lib/company-branding";
import { kgToMt } from "@/lib/unit-registry";
import { cn } from "@/lib/utils";

/** Whole kilograms — e.g. 10,000 */
function fmtWeightKg(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n));
}

/** Metric tonnes from kg — e.g. 10 or 50.885 (never grouped like thousands) */
function fmtWeightMt(kg: number): string {
  const mt = kgToMt(kg);
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
    useGrouping: false,
  }).format(mt);
}

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-PK", { dateStyle: "medium" });

/** Print CSS: hide the app shell and toolbar, print only the document. */
export const DELIVERY_ORDER_PRINT_CSS = `
.print-logo { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
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
    border: none !important;
  }
}
`;

export function DeliveryOrderPrintStyles() {
  return <style>{DELIVERY_ORDER_PRINT_CSS}</style>;
}

function LabelValueRow({
  label,
  value,
  labelClassName,
}: {
  label: string;
  value: string;
  labelClassName?: string;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 text-sm">
      <span className={cn("font-semibold text-black", labelClassName)}>{label}</span>
      <span className="text-black">{value || "—"}</span>
    </div>
  );
}

function SignatureBlock({ title, name }: { title: string; name: string | null }) {
  return (
    <div className="flex-1 text-center">
      <div className="mx-auto mt-12 w-full border-t border-black" />
      <div className="mt-1 text-[11px] font-semibold text-black">Signature &amp; Stamp</div>
      <div className="mt-0.5 text-[11px] text-black">{title}</div>
      {name && <div className="mt-1 text-[10px] text-neutral-600">{name}</div>}
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
      <div className={cn("mx-auto max-w-[720px] p-10 text-center", className)}>
        <p className="text-base font-semibold text-black">Not issued yet</p>
        <p className="mt-1 text-sm text-neutral-600">
          Generate the delivery order from the truck workflow first.
        </p>
      </div>
    );
  }
  if (!data?.deliveryOrderNo) return null;

  const productName = data.commodityName ?? "—";

  return (
    <div
      className={cn(
        "print-doc mx-auto w-full max-w-[720px] border border-black bg-white p-8 text-black",
        className,
      )}
    >
      {/* Header — company address + DO number */}
      <div className="flex items-start justify-between gap-4 border-b border-black/40 pb-4">
        <div className="min-w-0 flex-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/branding/logo-print.png"
            alt="Kastros"
            className="print-logo mb-2 block h-10 w-auto object-contain"
          />
          <p className="text-xs leading-snug text-neutral-700">{KASTROS_COMPANY_ADDRESS}</p>
        </div>
        <div className="shrink-0 text-right text-sm">
          <div className="font-semibold">DO No.</div>
          <div className="font-mono text-base font-bold">{data.deliveryOrderNo}</div>
        </div>
      </div>

      <h1 className="mt-4 text-center text-xl font-bold uppercase tracking-[0.15em]">
        Delivery Order
      </h1>

      {/* Buyer / warehouse block */}
      <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
        <LabelValueRow label="Buyer Name" value={data.buyerName} />
        <LabelValueRow label="Warehouse Name" value={data.warehouseName} />
        <LabelValueRow label="Buyer Address" value={data.buyerAddress ?? "—"} />
        <LabelValueRow label="Warehouse Location" value={data.warehouseLocation ?? "—"} />
        <LabelValueRow label="NTN" value={data.buyerNtn ?? "—"} />
        <LabelValueRow label="Delivery Order No" value={data.deliveryOrderNo} />
        <div className="col-span-2">
          <LabelValueRow
            label="Delivery Order Date"
            value={data.deliveryOrderDate ? fmtDate(data.deliveryOrderDate) : "—"}
          />
        </div>
        {data.warehouseAddress && (
          <div className="col-span-2">
            <LabelValueRow label="Warehouse Address" value={data.warehouseAddress} />
          </div>
        )}
      </div>

      <p className="mt-5 text-sm font-medium text-black">
        We authorize you to take delivery as follows:
      </p>

      <div className="mt-3 space-y-2">
        <LabelValueRow label="Commodity" value={productName} />
        <LabelValueRow label="Contract No." value={data.tradeRef ?? "—"} />
        <LabelValueRow label="Delivery Terms" value={data.deliveryTerms ?? "—"} />
        <LabelValueRow
          label="Actual Delivery date"
          value={data.actualDeliveryDate ? fmtDate(data.actualDeliveryDate) : "—"}
        />
      </div>

      {/* Line items */}
      <table className="mt-5 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-black">
            {["Product", "Lot #", "Weight In KGs", "Weight In MTs", "Remarks"].map((h) => (
              <th
                key={h}
                className={cn(
                  "px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide",
                  (h === "Weight In KGs" || h === "Weight In MTs") && "text-right",
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-black/30">
            <td className="px-2 py-2">{productName}</td>
            <td className="px-2 py-2">N/A</td>
            <td className="px-2 py-2 text-right tabular-nums">{fmtWeightKg(data.weightKg)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{fmtWeightMt(data.weightKg)}</td>
            <td className="px-2 py-2">{data.remarks ?? ""}</td>
          </tr>
          <tr className="font-semibold">
            <td className="px-2 py-2">Totals</td>
            <td className="px-2 py-2" />
            <td className="px-2 py-2 text-right tabular-nums">{fmtWeightKg(data.weightKg)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{fmtWeightMt(data.weightKg)}</td>
            <td className="px-2 py-2" />
          </tr>
        </tbody>
      </table>

      {/* Transporter */}
      <div className="mt-6">
        <div className="text-sm font-bold text-black">Transporter Details</div>
        <div className="mt-2">
          <LabelValueRow label="Truck No" value={data.truckNo} />
          {data.transporterName && (
            <div className="mt-1">
              <LabelValueRow
                label="Transporter"
                value={
                  data.transporterPhone
                    ? `${data.transporterName} · ${data.transporterPhone}`
                    : data.transporterName
                }
              />
            </div>
          )}
        </div>
      </div>

      {/* Signatures */}
      <div className="mt-10 flex gap-10 border-t border-black/30 pt-2">
        <SignatureBlock title="Finance" name={data.doFinanceApprovedBy} />
        <SignatureBlock title="Execution" name={data.doExecutionApprovedBy} />
      </div>
    </div>
  );
}
