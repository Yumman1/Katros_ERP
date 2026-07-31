"use client";

// NOTE: this layout is a PLACEHOLDER until the official Kastros contract note
// template is provided by the company — keep the data plumbing, swap the design.

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

/** Print CSS: hide the app shell and the toolbar, print only the document. */
const PRINT_CSS = `
/* Browsers drop background graphics by default — the logo must survive. */
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
      <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="mt-0.5 whitespace-pre-wrap text-sm text-black">{value || "—"}</div>
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

export default function TradeConfirmationPrintPage() {
  const params = useParams();
  const tradeRef = decodeURIComponent(params.ref as string);
  const { data: trade, isLoading, error } = trpc.trader.tradeByRef.useQuery({ tradeRef });

  const quotedUnit =
    trade?.priceCurrency && trade?.priceWeightUnit
      ? priceUnitLabel({ currency: trade.priceCurrency, weightUnit: trade.priceWeightUnit })
      : `${trade?.currency ?? "PKR"}/${trade?.quantityUnit ?? "MT"}`;

  // Contract value uses the canonical (per-MT) price so it matches the ledger,
  // while the rate is shown as quoted — ₨/maund is what was agreed.
  const unitPrice = trade ? (trade.pricePerCanonicalQty ?? trade.price) : 0;
  const goodsValue = trade ? trade.quantity * unitPrice : 0;
  const commission = trade?.commissionAmount ?? 0;
  const params_ = (trade?.tradeParams ?? {}) as Record<string, string | number | null>;
  // Booked trades carry the tolerance as mode + value; imported ones carry the
  // finished label ("+/-10% at seller option"). Prefer whichever is present.
  const tolerance =
    (trade ? formatQuantityTolerance(params_, trade.quantityUnit) : undefined) ??
    (params_.quantityTolerance ? String(params_.quantityTolerance).trim() : "");

  // A trade that execution has not locked is not a binding confirmation yet —
  // say so on the paper rather than letting a draft look like a contract.
  const isDraft = trade?.tradeStatus === "PENDING";
  const isCancelled = trade?.tradeStatus === "CANCELLED";

  return (
    <div className="min-h-screen bg-white text-black">
      <style>{PRINT_CSS}</style>

      {/* ── Toolbar (never printed) ── */}
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-black/10 px-4 py-3">
        <Link
          href={`/trader/trades/${encodeURIComponent(tradeRef)}`}
          className="text-sm font-medium text-black underline"
        >
          ← Back to trade
        </Link>
        <Link href="/trader/trades" className="text-sm text-neutral-600 underline">
          My trades
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
          {/* ── Company header ── */}
          <div className="border-b-2 border-black pb-3 text-center">
            {/* logo-print, not logo: the app's logo is composited on black for
                the dark shell and prints as a black box on white paper. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/branding/logo-print.png"
              alt="Kastros"
              className="print-logo mx-auto block h-12 w-auto object-contain"
            />
            <div className="mt-1.5 text-[11px] uppercase tracking-wider text-neutral-600">
              Agri-commodity trading · Pakistan
            </div>
            <div className="mt-3 text-lg font-bold uppercase tracking-[0.2em]">
              {trade.direction === "BUY" ? "Purchase" : "Sale"} Contract Note
            </div>
          </div>

          {(isDraft || isCancelled) && (
            <div className="mt-3 border border-black px-3 py-2 text-center text-[11px] font-bold uppercase tracking-wider">
              {isCancelled
                ? "Cancelled — this trade is no longer valid"
                : "Draft — not yet confirmed by execution"}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span>
              Contract no: <span className="font-mono font-bold">{trade.tradeRef}</span>
            </span>
            <span>Date: {fmtDate(trade.tradeDate)}</span>
          </div>

          {/* ── Parties ── */}
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-black/30 pt-4">
            <Field
              label={trade.direction === "BUY" ? "Seller" : "Buyer"}
              value={trade.counterparty.companyNameNtn || trade.counterparty.name}
            />
            <Field label="Counterparty code" value={trade.counterparty.code} />
            <Field label="NTN" value={trade.counterparty.ntn ?? "—"} />
            <Field label="Trader" value={trade.traderName} />
            {trade.counterparty.address ? (
              <Field label="Address" value={trade.counterparty.address} wide />
            ) : null}
          </div>

          {/* ── Goods ── */}
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-black/30 pt-4">
            <Field label="Commodity" value={`${trade.commodity.code} — ${trade.commodity.name}`} />
            <Field label="Grade" value={trade.grade || "—"} />
            <Field
              label="Quantity"
              value={`${fmtQty(trade.quantity)} ${trade.quantityUnit}${
                tolerance ? ` (${tolerance})` : ""
              }`}
            />
            <Field label="Origin" value={trade.productOrigin || trade.originName || "—"} />
            <Field label="Rate" value={`${fmtQty(trade.price)} ${quotedUnit}`} />
            <Field
              label="Commission"
              value={commission ? fmtMoney(commission, trade.currency) : "—"}
            />
            <Field label="Quality" value={trade.qualityTolerances || "—"} wide />
          </div>

          {/* ── Value ── */}
          <div className="mt-4 border-t border-black/30 pt-4">
            <table className="w-full text-sm">
              <tbody>
                <tr>
                  <td className="py-1 text-neutral-600">
                    Goods value ({fmtQty(trade.quantity)} {trade.quantityUnit} ×{" "}
                    {fmtQty(unitPrice)} {trade.currency}/{trade.quantityUnit})
                  </td>
                  <td className="py-1 text-right font-medium tabular-nums">
                    {fmtMoney(goodsValue, trade.currency)}
                  </td>
                </tr>
                {commission > 0 && (
                  <tr>
                    <td className="py-1 text-neutral-600">Commission</td>
                    <td className="py-1 text-right font-medium tabular-nums">
                      {fmtMoney(commission, trade.currency)}
                    </td>
                  </tr>
                )}
                <tr className="border-t border-black">
                  <td className="py-1.5 font-bold uppercase tracking-wider">Contract value</td>
                  <td className="py-1.5 text-right text-base font-bold tabular-nums">
                    {fmtMoney(goodsValue + commission, trade.currency)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ── Terms ── */}
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-black/30 pt-4">
            <Field label="Incoterms" value={trade.incoterms} />
            <Field label="Buying category" value={trade.buyingCategory ?? "—"} />
            <Field
              label="Delivery window"
              value={`${fmtDate(trade.deliveryStart)} — ${fmtDate(trade.deliveryEnd)}`}
            />
            <Field label="Delivery point" value={trade.destName || trade.originName || "—"} />
            <Field label="Payment terms" value={trade.paymentTerms || trade.paymentType} />
            <Field label="Price basis" value={trade.priceBasis} />
            {trade.notes ? <Field label="Notes" value={trade.notes} wide /> : null}
          </div>

          {/* ── Signatures ── */}
          <div className="mt-8 flex gap-10">
            <SignatureLine label="For Kastros" />
            <SignatureLine label={`For ${trade.counterparty.name}`} />
          </div>

          {/* Deemed acceptance — a trade confirmation binds unless disputed,
              so the paper says so rather than waiting on a countersignature. */}
          <p className="mt-6 border-t border-black/20 pt-2 text-center text-[10px] leading-relaxed text-neutral-600">
            This contract note is issued against contract{" "}
            <span className="font-mono font-semibold">{trade.tradeRef}</span>. If it is not signed
            and returned, and no written objection is received, within 24 hours of issue, it shall
            be deemed accepted and remains valid and binding on both parties without signature.
          </p>
          <p className="mt-1 text-center text-[10px] text-neutral-500">
            Issued {formatPkDateTime(new Date())} PKT
          </p>
        </div>
      )}
    </div>
  );
}
