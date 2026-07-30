"use client";

// The printed face of a cancellation / short-close note. Everything on it is
// read back from the ledger entry that IS the note — nothing is recomputed
// here, so the paper can never drift from the books.

import Link from "next/link";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc/client";

const fmtQty = (n: number) => new Intl.NumberFormat("en-PK", { maximumFractionDigits: 3 }).format(n);
const fmtMoney = (n: number) =>
  `${new Intl.NumberFormat("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} PKR`;
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

export default function SettlementNotePrintPage() {
  const params = useParams();
  const noteRef = decodeURIComponent(params.ref as string);
  const { data: note, isLoading, error } = trpc.trader.settlementNoteByRef.useQuery({ noteRef });

  const isDebit = note?.kind === "DEBIT";
  const title = isDebit ? "Debit Note" : "Credit Note";

  return (
    <div className="min-h-screen bg-white text-black">
      <style>{PRINT_CSS}</style>

      {/* ── Toolbar (never printed) ── */}
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-black/10 px-4 py-3">
        <Link href="/trader/trades" className="text-sm font-medium text-black underline">
          ← My trades
        </Link>
        {note?.trade && (
          <Link
            href={`/trader/trades/${encodeURIComponent(note.trade.tradeRef)}`}
            className="text-sm text-neutral-600 underline"
          >
            {note.trade.tradeRef}
          </Link>
        )}
        <button
          type="button"
          onClick={() => window.print()}
          disabled={!note}
          className="ml-auto rounded-md bg-black px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          Print
        </button>
      </div>

      {isLoading && <p className="p-8 text-sm text-neutral-600">Loading note…</p>}
      {error && <p className="p-8 text-sm text-red-700">{error.message}</p>}

      {note && (
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
            <div className="mt-3 text-lg font-bold uppercase tracking-[0.2em]">{title}</div>
          </div>

          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span>
              Note no: <span className="font-mono font-bold">{note.noteRef}</span>
            </span>
            <span>Date: {fmtDate(note.noteDate)}</span>
          </div>

          {/* ── Party ── */}
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-black/30 pt-4">
            <Field
              label={isDebit ? "Debited to" : "Credited to"}
              value={note.counterparty.companyNameNtn || note.counterparty.name}
            />
            <Field label="Counterparty code" value={note.counterparty.code} />
            <Field label="NTN" value={note.counterparty.ntn ?? "—"} />
            <Field
              label="Account"
              value={note.side === "BUY" ? "Purchase ledger" : "Sales ledger"}
            />
            {note.counterparty.address ? (
              <Field label="Address" value={note.counterparty.address} wide />
            ) : null}
          </div>

          {/* ── The trade it settles ── */}
          {note.trade && (
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-black/30 pt-4">
              <Field label="Against contract" value={note.trade.tradeRef} />
              <Field label="Contract date" value={fmtDate(note.trade.tradeDate)} />
              <Field
                label="Commodity"
                value={`${note.trade.commodityCode} — ${note.trade.commodityName}`}
              />
              <Field
                label="Contract quantity"
                value={`${fmtQty(note.trade.quantity)} ${note.trade.quantityUnit}`}
              />
              <Field label="Trader" value={note.trade.traderName} />
              <Field
                label="Direction"
                value={note.trade.direction === "BUY" ? "Purchase" : "Sale"}
              />
            </div>
          )}

          {/* ── The amount and how it was arrived at ── */}
          <div className="mt-4 border-t border-black/30 pt-4">
            {note.narrative && (
              <p className="text-[11px] leading-relaxed text-neutral-700">{note.narrative}</p>
            )}
            <table className="mt-3 w-full text-sm">
              <tbody>
                <tr className="border-t border-black">
                  <td className="py-1.5 font-bold uppercase tracking-wider">
                    {isDebit ? "Amount debited" : "Amount credited"}
                  </td>
                  <td className="py-1.5 text-right text-base font-bold tabular-nums">
                    {fmtMoney(note.amountPkr)}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-neutral-600">
              {isDebit
                ? "This amount is receivable from the counterparty."
                : "This amount is payable to the counterparty."}{" "}
              Status:{" "}
              <span className="font-semibold text-black">
                {note.status === "PAID" ? "Settled" : "Outstanding"}
              </span>
              {note.status === "PAID" && note.settledByVoucherNo
                ? ` against voucher ${note.settledByVoucherNo}${
                    note.settledAt ? ` on ${fmtDate(note.settledAt)}` : ""
                  }`
                : ""}
              .
            </p>
          </div>

          {note.approval && (
            <p className="mt-4 border-t border-black/30 pt-3 text-[11px] leading-relaxed text-neutral-700">
              Approved by {note.approval.actorName} on {fmtDate(note.approval.at)} —{" "}
              {note.approval.summary}
            </p>
          )}

          {/* ── Signatures ── */}
          <div className="mt-8 flex gap-10">
            <SignatureLine label="For Kastros" />
            <SignatureLine label={`For ${note.counterparty.name}`} />
          </div>

          <p className="mt-6 border-t border-black/20 pt-2 text-center text-[10px] leading-relaxed text-neutral-600">
            This note is issued against contract{" "}
            <span className="font-mono font-semibold">{note.trade?.tradeRef ?? "—"}</span>. If it is
            not signed and returned, and no written objection is received, within 24 hours of issue,
            it shall be deemed accepted and remains valid and binding on both parties without
            signature.
          </p>
          <p className="mt-1 text-center text-[10px] text-neutral-500">
            Issued {new Date().toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" })}
          </p>
        </div>
      )}
    </div>
  );
}
