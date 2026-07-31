"use client";

import { TRADE_SCOPE_LABELS } from "@/lib/trade-constants";
import { priceUnitLabel } from "@/lib/price-units";
import { trpc } from "@/lib/trpc/client";
import { formatCurrency, formatQty } from "@/lib/formatters/numbers";
import {
  isTraderDraft,
  traderCanCancelTrade,
  traderCancelBlockedReason,
  traderCanEditTrade,
  traderListStatusLabel,
} from "@/lib/trade-lifecycle";
import Link from "next/link";
import { TradeStatus } from "@prisma/client";
import { endOfMonth, format, startOfMonth } from "date-fns";
import { Ban, PenLine, Printer } from "lucide-react";
import { useState } from "react";
import { TradeEditModal } from "@/components/trader/trade-edit-modal";
import { TradeCancelModal } from "@/components/trader/trade-cancel-modal";

type TradeFilter =
  | "UNFINISHED"
  | "ALL"
  | "DRAFTS"
  | "LOCKED"
  | "CLOSED"
  | "CANCELLED";

const FILTERS: TradeFilter[] = [
  "UNFINISHED",
  "ALL",
  "DRAFTS",
  "LOCKED",
  "CLOSED",
  "CANCELLED",
];

const statusStyle: Partial<Record<TradeStatus, string>> = {
  PENDING: "bg-warning/20 text-warning",
  LOCKED: "bg-purple-500/20 text-purple-300",
  EXECUTED: "bg-zinc-500/20 text-muted-foreground",
  SETTLED: "bg-zinc-500/20 text-muted-foreground",
  CANCELLED: "bg-red-500/20 text-red-400",
};

function filterInput(filter: TradeFilter) {
  if (filter === "DRAFTS") return { bucket: "DRAFTS" as const };
  if (filter === "CLOSED") return { bucket: "CLOSED" as const };
  if (filter === "LOCKED") return { bucket: "LOCKED" as const };
  if (filter === "CANCELLED") return { bucket: "CANCELLED" as const };
  if (filter === "ALL") return {};
  return {};
}

export default function MyTradesPage() {
  const [filter, setFilter] = useState<TradeFilter>("ALL");
  const [editRef, setEditRef] = useState<string | null>(null);
  const [cancelRef, setCancelRef] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const { data: cancelledCount } = trpc.trader.myCancelledCount.useQuery();
  const { data: drafts, isLoading: draftsLoading } = trpc.trader.bookingDrafts.useQuery();
  const deleteDraft = trpc.trader.deleteBookingDraft.useMutation({
    onSuccess: () => void utils.trader.bookingDrafts.invalidate(),
  });
  const exportCsv = trpc.trader.exportLockedTrades.useMutation({
    onSuccess: (res) => {
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
    },
  });
  const { data: trades, isLoading } = trpc.trader.myTrades.useQuery(filterInput(filter), {
    enabled: filter !== "CANCELLED",
  });
  // The Cancelled tab is a different report, not a filter of the same one — a
  // dead trade is read through its note, not through its booking terms.
  const { data: cancelled, isLoading: cancelledLoading } =
    trpc.trader.myCancelledTrades.useQuery(undefined, { enabled: filter === "CANCELLED" });

  return (
    <div className="kastros-desk-page">
      <TradeEditModal tradeRef={editRef} open={editRef != null} onClose={() => setEditRef(null)} />
      <TradeCancelModal
        tradeRef={cancelRef}
        open={cancelRef != null}
        onClose={() => setCancelRef(null)}
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">My Trades</h1>
          <p className="text-sm text-subtle">
            Use <span className="text-foreground">Edit</span> on unreviewed trades only — locked
            contracts cannot change price, quantity, or commission. Cancelling a locked trade raises a
            debit note and goes to the CEO.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() =>
              exportCsv.mutate({
                from: startOfMonth(new Date()),
                to: endOfMonth(new Date()),
              })
            }
            className="rounded-md border border-kastros-border px-4 py-2 text-sm text-muted-foreground hover:bg-foreground/5"
          >
            Export locked (month)
          </button>
          <Link
            href="/trader/trades/new"
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-kastros-bg"
          >
            + Book Trade
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-md border px-3 py-1 text-xs ${
              filter === f
                ? "border-success bg-success/10 text-success"
                : "border-kastros-border text-muted-foreground hover:bg-foreground/5"
            }`}
          >
            {f === "UNFINISHED"
              ? `Unfinished (${drafts?.length ?? 0})`
              : f === "DRAFTS"
                ? "Unreviewed"
                : f === "CLOSED"
                  ? "Closed"
                  : f === "CANCELLED"
                    ? `Cancelled (${cancelledCount ?? 0})`
                    : f === "ALL"
                      ? "All"
                      : "Locked"}
          </button>
        ))}
      </div>

      {filter === "UNFINISHED" ? (
        draftsLoading ? (
          <div className="text-subtle">Loading unfinished bookings…</div>
        ) : !drafts?.length ? (
          <div className="rounded-xl border border-kastros-border bg-kastros-card px-6 py-10 text-center text-sm text-subtle">
            No unfinished bookings. Booking forms autosave here while you fill them in.
          </div>
        ) : (
          <div className="space-y-3">
            {drafts.map((d) => {
              const label =
                [
                  d.summary?.commodityLabel,
                  d.summary?.counterpartyLabel,
                  d.summary?.direction,
                  d.summary?.quantityLabel,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Untitled draft";
              return (
                <article
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-kastros-border bg-kastros-card px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{label}</div>
                    <div className="mt-0.5 text-xs text-subtle">
                      Last saved {format(new Date(d.updatedAt), "dd MMM yyyy HH:mm")}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/trader/trades/new?draft=${encodeURIComponent(d.id)}`}
                      className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-kastros-bg hover:opacity-90"
                    >
                      Resume
                    </Link>
                    <button
                      type="button"
                      disabled={deleteDraft.isPending}
                      onClick={() => {
                        if (confirm("Delete this unfinished booking draft?")) {
                          deleteDraft.mutate({ id: d.id });
                        }
                      }}
                      className="rounded-md border border-kastros-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-foreground/5 hover:text-destructive disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </article>
              );
            })}
            {deleteDraft.error && (
              <p className="text-xs text-kastros-red">{deleteDraft.error.message}</p>
            )}
          </div>
        )
      ) : filter === "CANCELLED" ? (
        cancelledLoading ? (
          <div className="text-subtle">Loading cancelled trades…</div>
        ) : !cancelled?.length ? (
          <div className="rounded-xl border border-kastros-border bg-kastros-card px-6 py-10 text-center text-sm text-subtle">
            No cancelled trades. Cancelling a locked trade raises a debit or credit note, and it
            lands here.
          </div>
        ) : (
          <CancelledTradesTable rows={cancelled} />
        )
      ) : isLoading ? (
        <div className="text-subtle">Loading trades…</div>
      ) : !trades?.length ? (
        <div className="rounded-xl border border-kastros-border bg-kastros-card px-6 py-10 text-center text-sm text-subtle">
          No trades match this filter.
        </div>
      ) : (
      <div className="kastros-table-wrap text-sm">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-kastros-card text-left text-xs uppercase text-subtle">
                <tr>
                  {[
                    "Actions",
                    "Trade ref",
                    "Date",
                    "Market",
                    "Side",
                    "Commodity",
                    "Qty (MT)",
                    "Price",
                    "Notional",
                    "Counterparty",
                    "Delivery",
                    "Status",
                  ].map((h) => (
                    <th key={h} className="border-b border-kastros-border px-2 py-2 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trades?.map((t) => (
                  <tr key={t.id} className="border-b border-kastros-border/60 hover:bg-foreground/[0.02]">
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1">
                        {traderCanEditTrade(t) && !t.settlementRequested ? (
                          <button
                            type="button"
                            onClick={() => setEditRef(t.tradeRef)}
                            className="inline-flex items-center gap-1 rounded-md border border-brand/40 bg-brand/10 px-2 py-1 text-[11px] font-semibold text-brand hover:bg-brand/20"
                            title={
                              isTraderDraft(t)
                                ? "Edit draft (saves directly)"
                                : "Propose changes (CEO approval required)"
                            }
                          >
                            <PenLine className="h-3 w-3" />
                            Edit
                          </button>
                        ) : null}
                        {traderCanCancelTrade(t) ? (
                          <button
                            type="button"
                            onClick={() => setCancelRef(t.tradeRef)}
                            className="inline-flex items-center gap-1 rounded-md border border-kastros-red/40 bg-kastros-red/10 px-2 py-1 text-[11px] font-semibold text-kastros-red hover:bg-kastros-red/20"
                            title="Cancel this trade — locked trades go to the CEO with a debit note"
                          >
                            <Ban className="h-3 w-3" />
                            Cancel
                          </button>
                        ) : null}
                        {/* Always available — a booked trade can be reprinted
                            at any point in its life, including once closed. */}
                        <Link
                          href={`/trader/print/trade/${encodeURIComponent(t.tradeRef)}`}
                          className="inline-flex items-center gap-1 rounded-md border border-kastros-border px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-foreground/5"
                          title="Print the contract note for this trade"
                        >
                          <Printer className="h-3 w-3" />
                          Print
                        </Link>
                        {!traderCanEditTrade(t) && !traderCanCancelTrade(t) && (
                          <span
                            className="sr-only"
                            title={traderCancelBlockedReason(t) ?? undefined}
                          >
                            {traderCancelBlockedReason(t) ?? ""}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <Link
                        href={`/trader/trades/${encodeURIComponent(t.tradeRef)}`}
                        className="font-mono text-xs text-success hover:underline"
                      >
                        {t.tradeRef}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-xs text-subtle">{t.tradeDate.toISOString().slice(0, 10)}</td>
                    <td className="px-2 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          (t.tradeScope ?? "LOCAL") === "LOCAL"
                            ? "bg-emerald-500/15 text-emerald-400"
                            : "bg-sky-500/15 text-sky-400"
                        }`}
                      >
                        {TRADE_SCOPE_LABELS[t.tradeScope ?? "LOCAL"]}
                      </span>
                    </td>
                    <td className={`px-2 py-2 text-xs font-medium ${t.direction === "BUY" ? "text-success" : "text-kastros-red"}`}>
                      {t.direction}
                    </td>
                    <td className="px-2 py-2">{t.commodity.code}</td>
                    <td className="px-2 py-2 data-grid">
                      {formatQty(t.quantity)} {t.quantityUnit ?? t.commodity.unit}
                    </td>
                    <td className="px-2 py-2 data-grid">
                      {t.price > 0 ? (
                        <>
                          {t.price.toLocaleString()}{" "}
                          <span className="text-subtle">
                            {t.priceCurrency && t.priceWeightUnit
                              ? priceUnitLabel({
                                  currency: t.priceCurrency,
                                  weightUnit: t.priceWeightUnit,
                                })
                              : `${t.currency}/${t.quantityUnit ?? t.commodity.unit}`}
                          </span>
                        </>
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 data-grid">
                      {formatCurrency(t.quantity * (t.pricePerCanonicalQty ?? t.price), t.currency)}
                    </td>
                    <td className="px-2 py-2 text-xs text-muted-foreground max-w-[120px] truncate">
                      {t.counterparty.name}
                    </td>
                    <td className="px-2 py-2 text-xs text-subtle">
                      {t.deliveryStart.toISOString().slice(0, 10)}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className={`rounded px-1.5 py-0.5 text-xs ${statusStyle[t.tradeStatus] ?? ""}`}>
                          {traderListStatusLabel(t)}
                        </span>
                        {t.settlementRequested && !t.directSettled && (
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-warning/20 text-warning">
                            Settlement pending
                          </span>
                        )}
                        {t.directSettled && (
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-success/15 text-success">
                            Directly settled
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
        </div>
      )}
    </div>
  );
}

type CancelledRow = {
  id: string;
  tradeRef: string;
  direction: string;
  commodityCode: string;
  quantity: number;
  quantityUnit: string;
  counterpartyName: string;
  cancelledAt: Date;
  noteRef: string | null;
  noteKind: "DEBIT" | "CREDIT" | null;
  noteAmountPkr: number | null;
  noteSide: "BUY" | "SELL" | null;
  noteStatus: "UNPAID" | "PAID" | null;
  noteSettledByVoucherNo: string | null;
  summary: string | null;
};

/**
 * The Cancelled tab. Price, notional and delivery are dead facts on a cancelled
 * trade — what matters is the note it settled in, what that note is worth, and
 * whether the money has moved.
 */
function CancelledTradesTable({ rows }: { rows: CancelledRow[] }) {
  return (
    <div className="kastros-table-wrap text-sm">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 bg-kastros-card text-left text-xs uppercase text-subtle">
          <tr>
            {[
              "Actions",
              "Trade ref",
              "Cancelled on",
              "Side",
              "Commodity",
              "Qty",
              "Counterparty",
              "Note no",
              "Note amount",
              "Ledger",
              "Status",
            ].map((h) => (
              <th key={h} className="border-b border-kastros-border px-2 py-2 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-kastros-border/60 hover:bg-foreground/[0.02]">
              <td className="px-2 py-2">
                <div className="flex items-center gap-1">
                  {r.noteRef ? (
                    <Link
                      href={`/trader/print/note/${encodeURIComponent(r.noteRef)}`}
                      className="inline-flex items-center gap-1 rounded-md border border-kastros-border px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-foreground/5"
                      title={`Print ${r.noteRef}`}
                    >
                      <Printer className="h-3 w-3" />
                      {r.noteKind === "CREDIT" ? "Credit note" : "Debit note"}
                    </Link>
                  ) : (
                    <span className="text-[11px] text-subtle">No note</span>
                  )}
                </div>
              </td>
              <td className="px-2 py-2">
                <Link
                  href={`/trader/trades/${encodeURIComponent(r.tradeRef)}`}
                  className="font-mono text-xs text-success hover:underline"
                >
                  {r.tradeRef}
                </Link>
              </td>
              <td className="px-2 py-2 text-xs text-muted-foreground whitespace-nowrap">
                {format(new Date(r.cancelledAt), "dd MMM yyyy")}
              </td>
              <td
                className={`px-2 py-2 text-xs font-medium ${r.direction === "BUY" ? "text-success" : "text-kastros-red"}`}
              >
                {r.direction}
              </td>
              <td className="px-2 py-2">{r.commodityCode}</td>
              <td className="px-2 py-2 data-grid">
                {formatQty(r.quantity)} {r.quantityUnit}
              </td>
              <td className="px-2 py-2 text-xs text-muted-foreground max-w-[140px] truncate">
                {r.counterpartyName}
              </td>
              <td className="px-2 py-2 font-mono text-xs">
                {r.noteRef ? (
                  <span
                    className={`rounded px-1.5 py-0.5 ${
                      r.noteKind === "CREDIT"
                        ? "bg-sky-500/15 text-sky-400"
                        : "bg-amber-500/15 text-amber-400"
                    }`}
                  >
                    {r.noteRef}
                  </span>
                ) : (
                  <span className="text-subtle">—</span>
                )}
              </td>
              <td className="px-2 py-2 data-grid">
                {r.noteAmountPkr != null ? (
                  formatCurrency(r.noteAmountPkr, "PKR")
                ) : (
                  <span
                    className="text-subtle"
                    title="Settlement price equalled the trade rate — nothing was owed either way"
                  >
                    No ledger entry
                  </span>
                )}
              </td>
              <td className="px-2 py-2 text-xs text-subtle">
                {r.noteSide ? (r.noteSide === "BUY" ? "Purchase" : "Sale") : "—"}
              </td>
              <td className="px-2 py-2">
                {r.noteStatus === "PAID" ? (
                  <span
                    className="rounded px-1.5 py-0.5 text-xs bg-success/15 text-success"
                    title={
                      r.noteSettledByVoucherNo
                        ? `Settled by ${r.noteSettledByVoucherNo}`
                        : undefined
                    }
                  >
                    Paid
                  </span>
                ) : r.noteStatus === "UNPAID" ? (
                  <span className="rounded px-1.5 py-0.5 text-xs bg-red-500/20 text-red-400">
                    Unpaid
                  </span>
                ) : (
                  <span className="rounded px-1.5 py-0.5 text-xs bg-zinc-500/20 text-muted-foreground">
                    Cancelled
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
