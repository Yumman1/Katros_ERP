"use client";

import { trpc } from "@/lib/trpc/client";
import { formatQty } from "@/lib/formatters/numbers";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  Info,
  Loader2,
  Plus,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";

const fmtPkr = (n: number) =>
  `${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(n)} PKR`;

const fmtDate = (d: Date | string) => format(new Date(d), "dd MMM yyyy");

type InvoiceStatus = "DRAFT" | "SENT" | "PARTIALLY_PAID" | "PAID" | "OVERDUE";

function InvoiceStatusChip({ status, voided }: { status: InvoiceStatus; voided: boolean }) {
  if (voided) {
    return (
      <span className="rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[10px] font-bold uppercase text-subtle line-through">
        Void
      </span>
    );
  }
  const map: Record<InvoiceStatus, { cls: string; label: string }> = {
    PAID: { cls: "bg-success/15 text-success", label: "Paid" },
    PARTIALLY_PAID: { cls: "bg-brand/15 text-brand", label: "Part paid" },
    OVERDUE: { cls: "bg-kastros-red/15 text-kastros-red", label: "Overdue" },
    SENT: { cls: "bg-warning/15 text-warning", label: "Awaiting payment" },
    DRAFT: { cls: "bg-foreground/[0.06] text-subtle", label: "Draft" },
  };
  const { cls, label } = map[status];
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", cls)}>
      {label}
    </span>
  );
}

function Metric({
  label,
  value,
  tone = "text-foreground",
  hint,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-kastros-border bg-kastros-card px-4 py-3">
      <div className="text-[10px] uppercase tracking-wide text-subtle">{label}</div>
      <div className={cn("mt-1 font-mono text-lg font-semibold tabular-nums", tone)}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-subtle">{hint}</div>}
    </div>
  );
}

/**
 * Settlement desk for one settled trade — the delivery was cancelled, so no
 * inventory and no truck. The trade amount is invoiced here, collected through
 * execution's vouchers, and the trade closes when the ledger holds it all.
 */
export default function TradeSettlementPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = use(params);
  const tradeRef = decodeURIComponent(ref);
  const utils = trpc.useUtils();

  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");

  const { data: s, isLoading } = trpc.trader.tradeSettlement.useQuery({ tradeRef });

  const refresh = async () => {
    await Promise.all([
      utils.trader.tradeSettlement.invalidate({ tradeRef }),
      utils.trader.settledTrades.invalidate(),
      utils.trader.myTrades.invalidate(),
      utils.trader.tradeTimeline.invalidate({ tradeRef }),
    ]);
  };

  const raise = trpc.trader.raiseSettlementInvoice.useMutation({
    onSuccess: async () => {
      setAmount("");
      setDueDate("");
      setNote("");
      await refresh();
    },
  });
  const voidInvoice = trpc.trader.voidSettlementInvoice.useMutation({ onSuccess: refresh });

  if (isLoading) {
    return (
      <div className="kastros-desk-page">
        <div className="flex items-center gap-2 py-16 text-sm text-subtle">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading settlement…
        </div>
      </div>
    );
  }

  if (!s) {
    return (
      <div className="kastros-desk-page space-y-4">
        <Link
          href="/trader/trades"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to My Trades
        </Link>
        <div className="rounded-xl border border-kastros-border bg-kastros-card px-6 py-10 text-center text-sm text-subtle">
          {tradeRef} is not a settled trade. Settlement opens once the CEO approves a direct
          settlement request.
        </div>
      </div>
    );
  }

  const amountNum = Number(amount);
  const canRaise =
    !s.isClosed && amountNum > 0 && amountNum <= s.uninvoicedPkr + 0.005 && !raise.isPending;

  return (
    <div className="kastros-desk-page space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/trader/trades"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to My Trades
          </Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-semibold text-foreground">
            <span className="font-mono">{s.tradeRef}</span>
            {s.isClosed ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-semibold text-success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Closed
              </span>
            ) : (
              <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs font-semibold text-warning">
                Collecting
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-subtle">
            {s.direction} · {s.commodityCode} · {formatQty(s.quantity)} {s.quantityUnit} ·{" "}
            {s.counterpartyName}
          </p>
        </div>
        <Link
          href={`/trader/trades/${encodeURIComponent(s.tradeRef)}`}
          className="rounded-md border border-kastros-border px-3 py-2 text-xs text-muted-foreground hover:bg-foreground/5"
        >
          Open trade
        </Link>
      </div>

      {/* ── How this settlement works ── */}
      <div className="flex gap-3 rounded-lg border border-kastros-border bg-kastros-card px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
        <div className="text-xs text-muted-foreground">
          <p>
            This trade was settled directly — the delivery was cancelled, so it produces{" "}
            <span className="text-foreground">no inventory and no truck entry</span>. Raise
            settlement invoices for the trade amount; execution records the money received against
            them on the{" "}
            <span className="text-foreground">Vouchers</span> tab, finance approves it into{" "}
            {s.counterpartyName}&apos;s ledger, and this trade closes automatically once the whole
            amount is in.
          </p>
          {s.settlementNote && (
            <p className="mt-1 text-subtle">Settlement reason: {s.settlementNote}</p>
          )}
        </div>
      </div>

      {/* ── Money ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Trade amount"
          value={fmtPkr(s.targetPkr)}
          hint={
            s.advanceTaxPkr > 0
              ? `${fmtPkr(s.notionalPkr)} + ${s.taxRatePct}% 236G`
              : "quantity × price"
          }
        />
        <Metric
          label="Invoiced"
          value={fmtPkr(s.invoicedPkr)}
          hint={s.uninvoicedPkr > 0 ? `${fmtPkr(s.uninvoicedPkr)} left to invoice` : "fully invoiced"}
        />
        <Metric
          label="In ledger"
          value={fmtPkr(s.collectedPkr)}
          tone="text-success"
          hint={
            s.pendingVoucherPkr > 0
              ? `${fmtPkr(s.pendingVoucherPkr)} awaiting finance`
              : "approved vouchers"
          }
        />
        <Metric
          label="Outstanding"
          value={fmtPkr(s.outstandingPkr)}
          tone={s.outstandingPkr > 0 ? "text-warning" : "text-success"}
          hint={`${s.progressPct}% collected`}
        />
      </div>

      <div className="flex items-center gap-3">
        <div className="h-2 w-full overflow-hidden rounded-full bg-foreground/10">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              s.isClosed ? "bg-success" : "bg-brand",
            )}
            style={{ width: `${Math.max(s.progressPct, s.progressPct > 0 ? 2 : 0)}%` }}
          />
        </div>
        <span className="shrink-0 font-mono text-xs text-subtle">{s.progressPct}%</span>
      </div>

      {s.isClosed && (
        <div className="flex gap-3 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-xs">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <div className="text-muted-foreground">
            <p className="font-semibold text-success">Settlement complete — trade closed.</p>
            <p className="mt-1">
              The full trade amount of {fmtPkr(s.targetPkr)} was gathered in{" "}
              {s.counterpartyName}&apos;s ledger
              {s.closedAt ? ` on ${fmtDate(s.closedAt)}` : ""}. No further invoices or vouchers can
              be raised against it.
            </p>
          </div>
        </div>
      )}

      {s.unbilledCollectedPkr > 0 && !s.isClosed && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-xs text-muted-foreground">
          <span className="font-semibold text-warning">
            {fmtPkr(s.unbilledCollectedPkr)} received without an invoice.
          </span>{" "}
          Money is already in the ledger for this trade beyond what has been invoiced — raise an
          invoice to cover it.
        </div>
      )}

      {/* ── Raise a settlement invoice ── */}
      {!s.isClosed && (
        <div className="rounded-xl border border-kastros-border bg-kastros-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Plus className="h-4 w-4 text-brand" />
            Raise settlement invoice
          </h2>
          <p className="mt-1 text-xs text-subtle">
            Posts a receivable of this amount onto {s.counterpartyName}&apos;s ledger. Invoice in as
            many parts as the payment is expected in — {fmtPkr(s.uninvoicedPkr)} left to invoice.
          </p>
          {s.uninvoicedPkr <= 0 ? (
            <p className="mt-3 rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-xs text-subtle">
              The whole trade amount has been invoiced. Collection now happens through vouchers.
            </p>
          ) : (
            <>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Amount (PKR) *
                  <input
                    type="number"
                    min={0}
                    max={s.uninvoicedPkr}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0"
                    className="kastros-input kastros-input-sm w-full"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Due date
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="kastros-input kastros-input-sm w-full"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-2">
                  What this invoice covers (optional)
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. First instalment of settlement"
                    className="kastros-input kastros-input-sm w-full"
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={!canRaise}
                  onClick={() =>
                    raise.mutate({
                      tradeRef,
                      amountPkr: amountNum,
                      dueDate: dueDate ? new Date(dueDate) : undefined,
                      note: note.trim() || undefined,
                    })
                  }
                  className="rounded-md bg-brand px-4 py-2 text-xs font-semibold text-kastros-bg hover:opacity-90 disabled:opacity-50"
                >
                  {raise.isPending ? "Raising…" : "Raise invoice"}
                </button>
                <button
                  type="button"
                  onClick={() => setAmount(String(s.uninvoicedPkr))}
                  className="rounded-md border border-kastros-border px-3 py-2 text-xs text-muted-foreground hover:bg-foreground/5"
                >
                  Invoice the full remainder
                </button>
                {amountNum > s.uninvoicedPkr + 0.005 && (
                  <span className="text-xs text-kastros-red">
                    Only {fmtPkr(s.uninvoicedPkr)} is left to invoice on this trade.
                  </span>
                )}
                {raise.error && <span className="text-xs text-kastros-red">{raise.error.message}</span>}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Invoices ── */}
      <div className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <FileText className="h-4 w-4 text-accent-secondary" />
          Settlement invoices ({s.invoices.filter((i) => !i.voidedAt).length})
        </h2>
        {s.invoices.length === 0 ? (
          <div className="rounded-xl border border-kastros-border bg-kastros-card px-6 py-8 text-center text-sm text-subtle">
            No settlement invoices yet. Raise one above to put the receivable on the ledger.
          </div>
        ) : (
          <div className="kastros-table-wrap text-sm">
            <table className="w-full border-collapse">
              <thead className="text-left text-xs uppercase text-subtle">
                <tr>
                  {["Invoice", "Raised", "Due", "Amount", "Received", "Outstanding", "Status", ""].map(
                    (h) => (
                      <th
                        key={h}
                        className="border-b border-kastros-border px-3 py-2 whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {s.invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    className={cn(
                      "border-b border-kastros-border/60",
                      inv.voidedAt && "opacity-50",
                    )}
                  >
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs font-semibold text-foreground">
                        {inv.invoiceRef}
                      </span>
                      {inv.note && <div className="text-[11px] text-subtle">{inv.note}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs text-subtle">{fmtDate(inv.invoiceDate)}</td>
                    <td className="px-3 py-2 text-xs text-subtle">{fmtDate(inv.dueDate)}</td>
                    <td className="px-3 py-2 font-mono text-xs tabular-nums text-foreground">
                      {fmtPkr(inv.amountPkr)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs tabular-nums text-success">
                      {fmtPkr(inv.paidPkr)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 font-mono text-xs tabular-nums",
                        inv.outstandingPkr > 0 ? "text-warning" : "text-subtle",
                      )}
                    >
                      {fmtPkr(inv.outstandingPkr)}
                    </td>
                    <td className="px-3 py-2">
                      <InvoiceStatusChip status={inv.status} voided={inv.voidedAt != null} />
                    </td>
                    <td className="px-3 py-2">
                      {!inv.voidedAt && !s.isClosed && inv.paidPkr === 0 && (
                        <button
                          type="button"
                          disabled={voidInvoice.isPending}
                          onClick={() => {
                            if (
                              confirm(
                                `Void ${inv.invoiceRef}? Its ${fmtPkr(inv.amountPkr)} receivable is removed from the ledger.`,
                              )
                            ) {
                              voidInvoice.mutate({ tradeRef, invoiceId: inv.id });
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-kastros-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-foreground/5 hover:text-kastros-red disabled:opacity-50"
                          title="Void this invoice and remove its ledger debit"
                        >
                          <X className="h-3 w-3" />
                          Void
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {voidInvoice.error && (
          <p className="text-xs text-kastros-red">{voidInvoice.error.message}</p>
        )}
      </div>

      {/* ── Vouchers (money in) ── */}
      <div className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Wallet className="h-4 w-4 text-accent-secondary" />
          Money received ({s.vouchers.length})
        </h2>
        {s.vouchers.length === 0 ? (
          <div className="rounded-xl border border-kastros-border bg-kastros-card px-6 py-8 text-center text-sm text-subtle">
            No vouchers against this trade yet. Execution records payments on the Vouchers tab —
            pick <span className="font-mono text-foreground">{s.tradeRef}</span> under “Against
            trade”.
          </div>
        ) : (
          <div className="kastros-table-wrap text-sm">
            <table className="w-full border-collapse">
              <thead className="text-left text-xs uppercase text-subtle">
                <tr>
                  {["Voucher", "Amount", "Method / Ref", "Entered by", "Date", "Status"].map((h) => (
                    <th
                      key={h}
                      className="border-b border-kastros-border px-3 py-2 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.vouchers.map((v) => (
                  <tr key={v.voucherNo} className="border-b border-kastros-border/60">
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-foreground">
                      {v.voucherNo}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs tabular-nums text-accent-secondary">
                      {fmtPkr(v.amountPkr)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {v.method ?? "—"}
                      {v.reference && (
                        <span className="ml-1 font-mono text-subtle">({v.reference})</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{v.enteredByName}</td>
                    <td className="px-3 py-2 text-xs text-subtle">{fmtDate(v.createdAt)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                          v.status === "APPROVED"
                            ? "bg-success/15 text-success"
                            : v.status === "REJECTED"
                              ? "bg-kastros-red/15 text-kastros-red"
                              : "bg-warning/15 text-warning",
                        )}
                      >
                        {v.status === "APPROVED"
                          ? "In ledger"
                          : v.status === "REJECTED"
                            ? "Rejected"
                            : "Pending finance"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
