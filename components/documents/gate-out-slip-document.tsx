"use client";

import type { SaleTruckPrintable } from "@/server/execution/sale-workflow";
import { KASTROS_COMPANY_ADDRESS } from "@/lib/company-branding";
import { cn } from "@/lib/utils";

const fmtKg = (n: number) =>
  `${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(n)} kg`;

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-PK", { dateStyle: "medium" });

const fmtDateTime = (d: Date | string) =>
  new Date(d).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });

/** Print CSS: hide the app shell and toolbar, print only the document. */
export const GATE_OUT_SLIP_PRINT_CSS = `
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

export function GateOutSlipPrintStyles() {
  return <style>{GATE_OUT_SLIP_PRINT_CSS}</style>;
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

function SignatureLine({ label }: { label: string }) {
  return (
    <div className="flex-1 text-center">
      <div className="mx-auto mt-10 w-full border-t border-black" />
      <div className="mt-1 text-[11px] text-black">{label}</div>
    </div>
  );
}

type Props = {
  data: SaleTruckPrintable;
  className?: string;
};

export function GateOutSlipDocument({ data, className }: Props) {
  return (
    <div
      className={cn(
        "print-doc mx-auto w-full max-w-[720px] border border-black bg-white p-8 text-black",
        className,
      )}
    >
      <div className="border-b-2 border-black pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/branding/logo-print.png"
              alt="Kastros"
              className="print-logo mb-1 block h-10 w-auto object-contain"
            />
            <p className="text-[10px] leading-snug text-neutral-600">{KASTROS_COMPANY_ADDRESS}</p>
          </div>
          <div className="text-right text-sm">
            <div className="text-lg font-bold uppercase tracking-[0.15em]">Gate Out Slip</div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span>
          Slip no: <span className="font-mono font-bold">{data.gateOutSlipNo}</span>
        </span>
        <span>Issued: {data.issuedAt ? fmtDateTime(data.issuedAt) : "—"}</span>
      </div>

      {data.deliveryOrderNo && (
        <p className="mt-3 rounded border border-black/40 bg-neutral-50 px-3 py-2 text-sm font-semibold text-black">
          Against Delivery Order number ={" "}
          <span className="font-mono">{data.deliveryOrderNo}</span>
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-black/30 pt-4">
        <Field label="Gatepass no" value={data.gatepassNo} />
        <Field label="Date" value={fmtDate(data.arrivalDate)} />
        <Field label="Truck no" value={data.truckNo} />
        <Field
          label="Transporter"
          value={
            data.transporterName
              ? `${data.transporterName}${data.transporterPhone ? ` · ${data.transporterPhone}` : ""}`
              : "—"
          }
        />
        <Field label="Builty" value={data.builtyDetails ?? "—"} wide />
        <Field label="Warehouse" value={data.warehouseName} />
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
        <Field label="Trade ref" value={data.tradeRef ?? "—"} />
        <Field
          label="Approvals"
          value={
            [
              data.saleTraderApprovedBy
                ? `Trader: ${data.saleTraderApprovedBy}${data.saleTraderApprovedAt ? ` (${fmtDateTime(data.saleTraderApprovedAt)})` : ""}`
                : null,
              data.saleFinanceApprovedBy
                ? `Finance: ${data.saleFinanceApprovedBy}${data.saleFinanceApprovedAt ? ` (${fmtDateTime(data.saleFinanceApprovedAt)})` : ""}`
                : null,
              data.saleCeoApprovedBy
                ? `CEO: ${data.saleCeoApprovedBy}${data.saleCeoApprovedAt ? ` (${fmtDateTime(data.saleCeoApprovedAt)})` : ""}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ") || "—"
          }
          wide
        />
        <Field label="Remarks" value={data.remarks ?? "—"} wide />
      </div>

      <div className="mt-8 flex gap-6 border-t border-black/30 pt-2">
        <SignatureLine label="Gate officer" />
        <SignatureLine label="Warehouse incharge" />
        <SignatureLine label="Receiver" />
      </div>
    </div>
  );
}
