"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { priceUnitLabel } from "@/lib/price-units";
import { formatQuantityTolerance } from "@/components/trader/quantity-tolerance-field";
import { formatPkDateTime } from "@/lib/formatters/datetime";

const fmtQty = (n: number) => new Intl.NumberFormat("en-PK", { maximumFractionDigits: 3 }).format(n);
const fmtMoney = (n: number, ccy = "PKR") =>
  `${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 2 }).format(n)} ${ccy}`;
const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-PK", { dateStyle: "medium" });

const PRINT_CSS = `
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

function Field({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="mt-0.5 whitespace-pre-wrap text-sm text-black">{value || "—"}</div>
    </div>
  );
}

export default function ExecutionTradePrintPage() {
  const params = useParams();
  const tradeRef = decodeURIComponent(params.ref as string);
  const { data: trade, isLoading, error } = trpc.execution.tradeForPrint.useQuery({ tradeRef });

  const quotedUnit =
    trade?.priceCurrency && trade?.priceWeightUnit
      ? priceUnitLabel({ currency: trade.priceCurrency, weightUnit: trade.priceWeightUnit })
      : `${trade?.currency ?? "PKR"}/${trade?.quantityUnit ?? "MT"}`;

  const unitPrice = trade ? (trade.pricePerCanonicalQty ?? trade.price) : 0;
  const goodsValue = trade ? trade.quantity * unitPrice : 0;
  const commission = trade?.commissionAmount ?? 0;
  const params_ = (trade?.tradeParams ?? {}) as Record<string, string | number | null>;
  const tolerance =
    (trade ? formatQuantityTolerance(params_, trade.quantityUnit) : undefined) ??
    (params_.quantityTolerance ? String(params_.quantityTolerance).trim() : "");

  return (
    <div className="min-h-screen bg-white text-black">
      <style>{PRINT_CSS}</style>
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-black/10 px-4 py-3">
        <Link href={`/execution/contracts`} className="text-sm font-medium text-black underline">
          ← Reviewed trades
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          disabled={!trade}
          className="ml-auto rounded-md bg-black px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          Print
        </button>
      </div>
      {isLoading && <p className="p-8 text-sm text-neutral-600">Loading trade…</p>}
      {error && <p className="p-8 text-sm text-red-700">{error.message}</p>}
      {trade && (
        <div className="print-doc mx-auto my-6 w-full max-w-[720px] border border-black bg-white p-8">
          <div className="border-b-2 border-black pb-3 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/branding/logo-print.png" alt="Kastros" className="print-logo mx-auto block h-12 w-auto object-contain" />
            <div className="mt-3 text-lg font-bold uppercase tracking-[0.2em]">
              {trade.direction === "BUY" ? "Purchase Contract" : "Sale Contract"}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span>
              Contract no: <span className="font-mono font-bold">{trade.tradeRef}</span>
            </span>
            <span>Date: {fmtDate(trade.tradeDate)}</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-black/30 pt-4">
            <Field
              label={trade.direction === "BUY" ? "Seller" : "Buyer"}
              value={trade.counterparty.companyNameNtn || trade.counterparty.name}
            />
            <Field label="NTN" value={trade.counterparty.ntn ?? "—"} />
            <Field label="Commodity" value={`${trade.commodity.code} — ${trade.commodity.name}`} />
            <Field
              label="Quantity"
              value={`${fmtQty(trade.quantity)} ${trade.quantityUnit}${tolerance ? ` (${tolerance})` : ""}`}
            />
            <Field label="Rate" value={`${fmtQty(trade.price)} ${quotedUnit}`} />
            <Field label="Payment terms" value={trade.paymentTerms || trade.paymentType} />
          </div>
          <div className="mt-4 border-t border-black/30 pt-4 text-sm">
            Contract value:{" "}
            <span className="font-bold tabular-nums">{fmtMoney(goodsValue + commission, trade.currency)}</span>
          </div>
          <p className="mt-6 text-center text-[10px] text-neutral-500">
            Issued {formatPkDateTime(new Date())} PKT
          </p>
        </div>
      )}
    </div>
  );
}
