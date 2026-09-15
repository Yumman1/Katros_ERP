"use client";

import { useRecordFilters } from "@/components/ui/record-filters";
import { field, tradeFields } from "@/lib/record-filters";

import { invalidateFinanceApprovalBadges } from "@/lib/invalidate-caches";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { ReceiptText } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";
import { ListPagination } from "@/components/ui/list-pagination";
import { useListPagination } from "@/lib/use-list-pagination";
import { paymentTypeLabel, type PaymentType } from "@/lib/trade-constants";
import { PAKISTAN_BANKS } from "@/lib/pakistan-banks";
import { formatPkDateTime } from "@/lib/formatters/datetime";

const VOUCHER_METHODS = ["Bank transfer", "Cheque", "Cash", "Other"] as const;
const VOUCHER_HISTORY_PAGE_SIZE = 5;

const fmtPkr = (n: number) =>
  `${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(n)} PKR`;

const fmtDateTime = (d: Date | string) => formatPkDateTime(d);

type VoucherStatus = "PENDING_FINANCE" | "APPROVED" | "REJECTED";

function StatusChip({ status }: { status: VoucherStatus }) {
  const cls =
    status === "APPROVED"
      ? "bg-success/15 text-success"
      : status === "REJECTED"
        ? "bg-destructive/15 text-destructive"
        : "bg-warning/15 text-warning";
  const label =
    status === "APPROVED" ? "Approved" : status === "REJECTED" ? "Rejected" : "Pending finance";
  return (
    <span className={cn("rounded-full px-2 py-1 text-[10px] font-bold uppercase", cls)}>
      {label}
    </span>
  );
}

export default function ExecutionVouchersPage() {
  const utils = trpc.useUtils();
  const { data: counterparties } = trpc.execution.sellCounterparties.useQuery();
  const { data: vouchers, isLoading } = trpc.execution.vouchers.useQuery(undefined);

  const [side, setSide] = useState<"SELL" | "BUY">("SELL");
  const [counterpartyId, setCounterpartyId] = useState("");
  const [tradeRef, setTradeRef] = useState("");
  /** Set instead of tradeRef when the voucher settles a DN/CN. */
  const [noteRef, setNoteRef] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>(VOUCHER_METHODS[0]);
  const [bankName, setBankName] = useState("");
  const [voucherDate, setVoucherDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  // Open SELL trades of the chosen counterparty — feeds the "against trade" select.
  const { data: sellTrades } = trpc.execution.sellTradesForCounterparty.useQuery(
    { counterpartyId, side },
    { enabled: counterpartyId !== "" },
  );
  // Cancellation / short-close notes still owed on this account — the same
  // select lists them, and picking one fills in the amount that is due.
  const { data: openNotes } = trpc.execution.openSettlementNotes.useQuery(
    { counterpartyId, side },
    { enabled: counterpartyId !== "" },
  );

  const clearAgainst = () => {
    setTradeRef("");
    setNoteRef("");
  };

  const create = trpc.execution.createVoucher.useMutation({
    onSuccess: () => {
      setCounterpartyId("");
      clearAgainst();
      setAmount("");
      setMethod(VOUCHER_METHODS[0]);
      setBankName("");
      setVoucherDate(new Date().toISOString().slice(0, 10));
      setReference("");
      setNote("");
      void utils.execution.vouchers.invalidate();
      void utils.execution.counterpartyLedgers.invalidate();
      void utils.execution.saleWorkflowRows.invalidate();
      void utils.policy.overdueLedgerAlerts.invalidate();
      // Finance mirrors of the voucher queue — keep them fresh in-session.
      void utils.finance.vouchers.invalidate();
      invalidateFinanceApprovalBadges(utils);
    },
  });

  const listFilters = useRecordFilters("vouchers", vouchers, { fields: [tradeFields[0], tradeFields[3], field("status", "Status"), field("method", "Payment method")], date: { label: "Voucher date", paths: ["voucherDate"] } });
  const pagination = useListPagination(listFilters.rows, { pageSize: VOUCHER_HISTORY_PAGE_SIZE, resetKey: listFilters.resetKey });

  const duplicateCheckInput = useMemo(
    () => ({
      bankName: method === "Bank transfer" ? bankName.trim() : undefined,
      reference: reference.trim(),
      voucherDate: new Date(voucherDate),
      amountPkr: Number(amount),
    }),
    [method, bankName, reference, voucherDate, amount],
  );

  const duplicateCheckReady =
    duplicateCheckInput.reference !== "" &&
    Number.isFinite(duplicateCheckInput.amountPkr) &&
    duplicateCheckInput.amountPkr > 0 &&
    !(method === "Bank transfer" && !bankName.trim());

  const { data: duplicateVoucher } = trpc.execution.findVoucherDuplicate.useQuery(
    duplicateCheckInput,
    { enabled: duplicateCheckReady, staleTime: 5_000 },
  );

  // A purchase voucher must name a settled trade or open note — no unlinked payment.
  const canSubmit =
    counterpartyId !== "" &&
    Number(amount) > 0 &&
    (side === "SELL" || tradeRef !== "" || noteRef !== "") &&
    !(method === "Bank transfer" && !bankName.trim()) &&
    reference.trim() !== "" &&
    !duplicateVoucher &&
    !create.isPending;

  if (isLoading && !vouchers) {
    return (
      <div className="kastros-desk-page">
        <PageLoadingSkeleton label="Loading vouchers…" rows={8} />
      </div>
    );
  }

  return (
    <div className="kastros-desk-page pb-6">
      <PageHeader
        breadcrumb={
          <>
            <Link href="/execution" className="hover:text-foreground">
              Desk
            </Link>
            <span>/</span>
            <span className="text-muted-foreground">Vouchers</span>
          </>
        }
        title="Vouchers"
        subtitle="Record money received from a counterparty — finance approval credits it into their ledger, unlocking their trucks and closing settled trades once the full amount is in."
      />

      {/* Form stays compact at the top; history grows below and the whole page scrolls. */}
      <div className="exec-panel p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ReceiptText className="h-4 w-4 text-accent-secondary" />
            New payment voucher
          </h2>

          {/* Which ledger the money lands on. A purchase credits the buy
              account, a sale the sell account — the two never mix. */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="exec-segment h-8">
              {(["SELL", "BUY"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setSide(s);
                    clearAgainst();
                  }}
                  className={cn(
                    "exec-segment-item px-3 py-1 text-xs",
                    side === s && "exec-segment-active",
                  )}
                >
                  {s === "SELL" ? "Sale" : "Purchase"}
                </button>
              ))}
            </div>
            <span className="text-xs text-subtle">
              {side === "SELL"
                ? "Credits the sell ledger — money received from a buyer."
                : "Credits the buy ledger — settles a purchase or debit-note receivable."}
            </span>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
              Counterparty
              <select
                value={counterpartyId}
                onChange={(e) => {
                  setCounterpartyId(e.target.value);
                  clearAgainst();
                }}
                className="kastros-select kastros-select-sm w-full"
              >
                <option value="">Select counterparty…</option>
                {(counterparties ?? []).map((cp) => (
                  <option key={cp.id} value={cp.id}>
                    {cp.code} — {cp.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
              {side === "SELL" ? "Trade reference (optional)" : "Against trade (required)"}
              <select
                value={noteRef ? `note:${noteRef}` : tradeRef ? `trade:${tradeRef}` : ""}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v.startsWith("note:")) {
                    const ref = v.slice(5);
                    setNoteRef(ref);
                    setTradeRef("");
                    const n = (openNotes ?? []).find((x) => x.noteRef === ref);
                    if (n) setAmount(String(n.remainingPkr ?? n.amountPkr));
                  } else {
                    setNoteRef("");
                    setTradeRef(v.startsWith("trade:") ? v.slice(6) : "");
                  }
                }}
                disabled={counterpartyId === ""}
                required={side === "BUY"}
                className="kastros-select kastros-select-sm w-full disabled:opacity-50"
              >
                {side === "SELL" ? (
                  <option value="">No trade reference</option>
                ) : (
                  <option value="" disabled>
                    Select settled purchase or note (required)
                  </option>
                )}
                {(sellTrades ?? []).map((t) => (
                  <option key={t.tradeRef} value={`trade:${t.tradeRef}`}>
                    {t.tradeRef} ·{" "}
                    {t.isSettlement
                      ? "Settlement (no delivery)"
                      : paymentTypeLabel(t.paymentType as PaymentType)}{" "}
                    · {t.quantity} {t.quantityUnit}
                  </option>
                ))}
                {(openNotes ?? []).length > 0 && (
                  <optgroup
                    label={
                      side === "BUY"
                        ? "Debit notes (receivable)"
                        : "Cancellation / short-close notes"
                    }
                  >
                    {(openNotes ?? []).map((n) => (
                      <option key={n.noteRef} value={`note:${n.noteRef}`}>
                        {n.noteRef} · {fmtPkr(n.remainingPkr ?? n.amountPkr)} due of{" "}
                        {fmtPkr(n.billedPkr ?? n.amountPkr)}
                        {n.tradeRef ? ` · ${n.tradeRef}` : ""}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              {side === "SELL" ? (
                <span className="text-[10px] leading-snug text-subtle">
                  Optional — for reconciliation. All approved credits join the buyer&rsquo;s shared pool.
                </span>
              ) : (
                <span className="text-[10px] leading-snug text-subtle">
                  Required — settled purchase or open note. Debit notes can be paid in pieces until within
                  500 PKR of the full amount.
                </span>
              )}
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
              Amount (PKR)
              <input
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                title={
                  noteRef
                    ? `Partial payment allowed — remaining due shown when the note was selected`
                    : undefined
                }
                placeholder="0"
                className="kastros-input kastros-input-sm w-full"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
              Voucher date
              <input
                type="date"
                value={voucherDate}
                onChange={(e) => setVoucherDate(e.target.value)}
                className="kastros-input kastros-input-sm w-full"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
              Method
              <select
                value={method}
                onChange={(e) => {
                  setMethod(e.target.value);
                  if (e.target.value !== "Bank transfer") setBankName("");
                }}
                className="kastros-select kastros-select-sm w-full"
              >
                {VOUCHER_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            {method === "Bank transfer" && (
              <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
                Bank
                <select
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  className="kastros-select kastros-select-sm w-full"
                  required
                >
                  <option value="">Select bank…</option>
                  {PAKISTAN_BANKS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
              Reference
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Slip / cheque / transfer no."
                required
                className="kastros-input kastros-input-sm w-full"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
              Note (optional)
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Note"
                className="kastros-input kastros-input-sm w-full"
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() =>
                create.mutate({
                  counterpartyId,
                  side,
                  tradeRef: tradeRef || undefined,
                  noteRef: noteRef || undefined,
                  amountPkr: Number(amount),
                  method,
                  bankName: method === "Bank transfer" ? bankName : undefined,
                  voucherDate: new Date(voucherDate),
                  reference: reference.trim(),
                  note: note.trim() || undefined,
                })
              }
              className="kastros-btn-primary px-4 py-2 text-xs disabled:opacity-50"
            >
              {create.isPending ? "Submitting…" : "Submit for finance approval"}
            </button>
            {create.error && (
              <span className="text-xs text-destructive">{create.error.message}</span>
            )}
            {duplicateVoucher && (
              <span className="text-xs text-destructive">
                Duplicate payment — {duplicateVoucher.voucherNo} already exists with the same bank,
                reference, date, and amount (
                {duplicateVoucher.status === "APPROVED" ? "approved" : "pending finance"}).
              </span>
            )}
            {create.isSuccess && !create.isPending && (
              <span className="text-xs text-success">Voucher submitted — pending finance.</span>
            )}
          </div>
        </div>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Voucher history</h2>
          {(vouchers ?? []).length > 0 && (
            <span className="text-xs text-subtle">
              {pagination.totalItems} voucher{pagination.totalItems === 1 ? "" : "s"}
            </span>
          )}
        </div>
        {listFilters.controls}
        <div className="kastros-table-wrap min-h-[22rem]">
          <table className="kastros-table text-xs">
            <thead>
              <tr>
                {[
                  "Voucher no",
                  "Counterparty",
                  "Against",
                  "Amount",
                  "Method / Ref",
                  "Status",
                  "Entered by",
                  "Date",
                  "Resolution",
                ].map((h) => (
                  <th key={h} className="px-5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagination.items.map((v) => (
                <tr key={v.id}>
                  <td className="px-5 py-3">
                    <span className="font-mono font-semibold text-foreground">{v.voucherNo}</span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="text-foreground">{v.counterpartyName}</div>
                    <div className="font-mono text-subtle">{v.counterpartyCode}</div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-1">
                      <span
                        className={cn(
                          "rounded-full px-2 py-1 text-[10px] font-bold uppercase",
                          v.side === "BUY"
                            ? "bg-warning/15 text-warning"
                            : "bg-success/15 text-success",
                        )}
                      >
                        {v.side === "BUY" ? "Purchase" : "Sale"}
                      </span>
                      {v.noteRef && (
                        <span className="rounded-full bg-warning/15 px-2 py-1 font-mono text-[10px] font-bold text-warning">
                          Settles {v.noteRef}
                        </span>
                      )}
                      {v.tradeRef ? (
                        <span className="rounded-full bg-accent-secondary-muted px-2 py-1 font-mono text-[10px] font-bold text-accent-secondary">
                          {v.tradeRef}
                        </span>
                      ) : v.noteRef ? null : (
                        <span className="rounded-full bg-foreground/[0.06] px-2 py-1 text-[10px] font-bold text-muted-foreground">
                          No trade ref
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 font-mono font-semibold tabular-nums text-accent-secondary">
                    {fmtPkr(v.amountPkr)}
                  </td>
                  <td className="px-5 py-3">
                    <div className="text-muted-foreground">
                      {v.method ?? "—"}
                      {v.bankName ? ` · ${v.bankName}` : ""}
                    </div>
                    {v.reference && <div className="font-mono text-subtle">{v.reference}</div>}
                  </td>
                  <td className="px-5 py-3">
                    <StatusChip status={v.status} />
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{v.enteredByName ?? "—"}</td>
                  <td className="px-5 py-3 whitespace-nowrap text-muted-foreground">
                    {fmtDateTime(v.voucherDate ?? v.createdAt)}
                  </td>
                  <td className="px-5 py-3">
                    {v.resolvedByName ? (
                      <>
                        <div className="text-muted-foreground">{v.resolvedByName}</div>
                        {v.resolutionNote && (
                          <div className="max-w-[220px] truncate text-subtle" title={v.resolutionNote}>
                            {v.resolutionNote}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-subtle">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(vouchers ?? []).length === 0 && (
            <div className="flex flex-col items-center justify-center px-5 py-12 text-center">
              <ReceiptText className="mb-2 h-8 w-8 text-subtle" />
              <p className="text-sm text-subtle">No vouchers entered yet</p>
            </div>
          )}
        </div>
        <ListPagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          totalItems={pagination.totalItems}
          startIndex={pagination.startIndex}
          endIndex={pagination.endIndex}
          onPageChange={pagination.setPage}
        />
      </section>
    </div>
  );
}
