"use client";

// NOTE: this layout is a PLACEHOLDER until the official Kastros delivery order
// template is provided by the company — keep the data plumbing, swap the design.

import Link from "next/link";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc/client";

const fmtKg = (n: number) =>
  `${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(n)} kg`;

const fmtDateTime = (d: Date | string) =>
  new Date(d).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });

/** Print CSS: hide the app shell and the toolbar, print only the document. */
const PRINT_CSS = `
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

export default function DeliveryOrderPrintPage() {
  const params = useParams();
  const truckId = params.truckId as string;
  const { data, isLoading, error } = trpc.execution.saleTruckPrintable.useQuery({ truckId });

  return (
    <div className="min-h-screen bg-white text-black">
      <style>{PRINT_CSS}</style>

      <div className="no-print flex flex-wrap items-center gap-2 border-b border-black/10 px-4 py-3">
        <Link href="/execution/movements" className="text-sm font-medium text-black underline">
          ← Back to movements
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          disabled={!data?.deliveryOrderNo}
          className="ml-auto rounded-md bg-black px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          Print
        </button>
      </div>

      {isLoading && <p className="p-8 text-sm text-neutral-600">Loading delivery order…</p>}
      {error && <p className="p-8 text-sm text-red-700">{error.message}</p>}

      {data && !data.deliveryOrderNo && (
        <div className="mx-auto max-w-[560px] p-10 text-center">
          <p className="text-base font-semibold">Not issued yet</p>
          <p className="mt-1 text-sm text-neutral-600">
            Generate the delivery order from the truck workflow first.
          </p>
        </div>
      )}

      {data && data.deliveryOrderNo && (
        <div className="print-doc mx-auto my-6 w-full max-w-[560px] border border-black bg-white p-6">
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
      )}
    </div>
  );
}
