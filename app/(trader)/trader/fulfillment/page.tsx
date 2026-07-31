"use client";

import { PageHeader } from "@/components/ui/page-header";
import { ListPagination } from "@/components/ui/list-pagination";
import { useListPagination } from "@/lib/use-list-pagination";
import { formatQtyWithUnit } from "@/lib/formatters/numbers";
import { warehouseShareOfOrder } from "@/lib/warehouse-allocation";
import { trpc } from "@/lib/trpc/client";
import { TRADE_SCOPE_LABELS } from "@/lib/trade-constants";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useMemo, useState } from "react";
import { FileMinus2, Search, Send, X } from "lucide-react";

const fmtNum = (n: number) => n.toLocaleString("en-PK", { maximumFractionDigits: 2 });

export default function TraderFulfillmentPage() {
  const utils = trpc.useUtils();
  const { data: trades, isLoading } = trpc.trader.tradeFulfillment.useQuery(undefined, {
    refetchInterval: 20000,
  });
  const { data: myRequests } = trpc.team.myChangeRequests.useQuery();

  const [closeRef, setCloseRef] = useState<string | null>(null);
  const [closeComment, setCloseComment] = useState("");
  const [settlementPrice, setSettlementPrice] = useState("");

  const settlementNum = Number(settlementPrice);
  const settlementValid = Number.isFinite(settlementNum) && settlementNum > 0;

  // The note the CEO will be asked to approve: trade rate and open qty on
  // open, live amount once a settlement price is entered.
  const { data: note } = trpc.trader.settlementNotePreview.useQuery(
    {
      tradeRef: closeRef ?? "",
      settlementPricePerMaund: settlementValid ? settlementNum : undefined,
    },
    { enabled: !!closeRef },
  );

  const submitClose = trpc.team.submitChangeRequest.useMutation({
    onSuccess: () => {
      setCloseRef(null);
      setCloseComment("");
      setSettlementPrice("");
      void utils.team.myChangeRequests.invalidate();
      void utils.trader.tradeFulfillment.invalidate();
    },
  });

  // Within tolerance the trader closes alone — no CEO round-trip.
  const freeClose = trpc.trader.closeTrade.useMutation({
    onSuccess: () => {
      void utils.trader.tradeFulfillment.invalidate();
      void utils.trader.myTrades.invalidate();
    },
  });

  const pendingCloseRefs = new Set(
    (myRequests ?? [])
      .filter(
        (r) =>
          r.entityType === "TRADE" &&
          r.action === "CLOSE" &&
          (r.status === "PENDING" || r.status === "PENDING_CEO"),
      )
      .map((r) => r.entityRef),
  );

  const openCount = trades?.filter((t) => t.contractStatus === "Open").length ?? 0;

  // Search narrows the whole list; the pager then works on what is left, so a
  // match on page 4 is reachable by typing instead of clicking through.
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return trades ?? [];
    return (trades ?? []).filter((t) =>
      [t.tradeRef, t.counterpartyName, t.commodityCode, t.commodityName, t.incoterms]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [trades, search]);
  const pagination = useListPagination(filtered, { pageSize: 10, resetKey: search });

  return (
    <div className="kastros-desk-page">
      <PageHeader
        title="Trade fulfillment"
        subtitle="Physical progress on locked trades. Within tolerance you close a trade yourself; short of the tolerance floor a close goes to the CEO. Trades auto-close above contract + tolerance."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label="Locked trades" value={String(trades?.length ?? 0)} />
        <Stat label="Open" value={String(openCount)} accent="warning" />
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by trade ref, counterparty, commodity, incoterm…"
          className="kastros-input w-full pl-9"
        />
      </div>

      <div className="kastros-desk-scroll space-y-4 pb-6">
      {isLoading ? (
        <div className="py-12 text-center text-sm text-subtle">Loading fulfillment…</div>
      ) : !trades?.length ? (
        <div className="rounded-xl border border-border bg-card px-6 py-12 text-center text-sm text-subtle">
          No locked trades yet. Book and lock a trade to track fulfillment here.
        </div>
      ) : !filtered.length ? (
        <div className="rounded-xl border border-border bg-card px-6 py-12 text-center text-sm text-subtle">
          No trades match “{search.trim()}”.
        </div>
      ) : (
        <div className="space-y-4">
          {pagination.items.map((t) => {
            const pct = t.fulfillmentPct;
            const isBuy = t.direction === "BUY";
            const closePending = pendingCloseRefs.has(t.tradeRef);
            // Received within tolerance → the trader closes without the CEO.
            const closeFloorQty = Math.max(0, t.contractualQtyMt - t.quantityToleranceMt);
            const withinTolerance = t.receivedQtyMt + 1e-9 >= closeFloorQty;
            return (
              <article key={t.tradeRef} className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link
                      href={`/trader/trades/${encodeURIComponent(t.tradeRef)}`}
                      className="font-mono text-lg font-semibold text-accent-secondary hover:underline"
                    >
                      {t.tradeRef}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-subtle">
                      <span>{TRADE_SCOPE_LABELS[t.tradeScope]}</span>
                      <span>·</span>
                      <span className={isBuy ? "text-success" : "text-info"}>{t.direction}</span>
                      <span>·</span>
                      <span>{t.incoterms}</span>
                      <span>·</span>
                      <span>{t.counterpartyName}</span>
                    </div>
                    <div className="mt-0.5 text-sm text-muted-foreground">
                      {t.commodityCode} — {t.commodityName}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase",
                        t.contractStatus === "Open" ? "bg-warning/15 text-warning" : "bg-success/15 text-success",
                      )}
                    >
                      {t.contractStatus === "Open" ? "In progress" : "Fulfilled"}
                    </span>
                    {t.contractStatus === "Open" && (
                      closePending ? (
                        <span className="text-[10px] font-medium text-accent-secondary">Close pending CEO</span>
                      ) : withinTolerance ? (
                        <button
                          type="button"
                          disabled={freeClose.isPending && freeClose.variables?.tradeRef === t.tradeRef}
                          onClick={() => freeClose.mutate({ tradeRef: t.tradeRef })}
                          className="rounded-md bg-success px-2.5 py-1 text-[10px] font-bold text-white hover:bg-success/90 disabled:opacity-50"
                        >
                          {freeClose.isPending && freeClose.variables?.tradeRef === t.tradeRef
                            ? "Closing…"
                            : "Close trade"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setCloseRef(t.tradeRef);
                            setCloseComment("");
                            setSettlementPrice("");
                            submitClose.reset();
                          }}
                          className="text-[10px] font-medium text-brand hover:underline"
                        >
                          Request close (CEO)
                        </button>
                      )
                    )}
                    {freeClose.error && freeClose.variables?.tradeRef === t.tradeRef && (
                      <span className="max-w-[220px] text-right text-[10px] text-destructive">
                        {freeClose.error.message}
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-subtle">Contract</div>
                    <div className="tabular-nums text-sm font-medium text-foreground">
                      {formatQtyWithUnit(t.contractualQtyMt, t.quantityUnit, 2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-subtle">Tolerance</div>
                    <div className="tabular-nums text-sm font-medium text-muted-foreground">
                      ±{formatQtyWithUnit(t.quantityToleranceMt, t.quantityUnit, 2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-subtle">
                      {isBuy ? "Received" : "Dispatched"}
                    </div>
                    <div className="tabular-nums text-sm font-medium text-success">
                      {formatQtyWithUnit(t.receivedQtyMt, t.quantityUnit, 2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-subtle">Remaining</div>
                    <div className="tabular-nums text-sm font-medium text-muted-foreground">
                      {formatQtyWithUnit(t.openQtyMt, t.quantityUnit, 2)}
                    </div>
                  </div>
                </div>

                {t.contractStatus === "Open" && (
                  <p className="mt-3 text-[11px] text-subtle">
                    {withinTolerance ? (
                      <>
                        {isBuy ? "Received" : "Dispatched"} qty is at or above the tolerance floor of{" "}
                        <span className="font-medium text-foreground">
                          {formatQtyWithUnit(closeFloorQty, t.quantityUnit, 2)}
                        </span>{" "}
                        — you can close this trade yourself. Auto-closes above{" "}
                        {formatQtyWithUnit(t.autoCloseAboveQtyMt, t.quantityUnit, 2)}.
                      </>
                    ) : (
                      <>
                        {isBuy ? "Received" : "Dispatched"} qty is below the tolerance floor of{" "}
                        <span className="font-medium text-foreground">
                          {formatQtyWithUnit(closeFloorQty, t.quantityUnit, 2)}
                        </span>{" "}
                        — closing short needs CEO approval. Auto-closes above{" "}
                        {formatQtyWithUnit(t.autoCloseAboveQtyMt, t.quantityUnit, 2)}.
                      </>
                    )}
                  </p>
                )}

                <div className="mt-4">
                  <div className="mb-1 flex justify-between text-xs text-subtle">
                    <span>Overall progress</span>
                    <span className="tabular-nums font-medium text-foreground">{(pct * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-foreground/[0.08]">
                    <div
                      className="h-full rounded-full bg-success transition-all"
                      style={{ width: `${Math.min(pct * 100, 100)}%` }}
                    />
                  </div>
                </div>

                {t.warehouseAllocationProgress.length > 0 && (
                  <div className="mt-4 overflow-x-auto">
                    <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-subtle">
                      By warehouse
                    </div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-subtle">
                          <th className="pb-1 pr-3 font-medium">Warehouse</th>
                          <th className="pb-1 pr-3 font-medium tabular-nums">Allocated</th>
                          <th className="pb-1 pr-3 font-medium tabular-nums">Done</th>
                          <th className="pb-1 pr-3 font-medium tabular-nums">Open</th>
                          <th className="pb-1 font-medium tabular-nums">% of order</th>
                        </tr>
                      </thead>
                      <tbody>
                        {t.warehouseAllocationProgress.map((p) => (
                          <tr key={p.warehouseName} className="text-muted-foreground">
                            <td className="py-1 pr-3">{p.warehouseName}</td>
                            <td className="py-1 pr-3 tabular-nums">
                              {formatQtyWithUnit(p.qtyMt, t.quantityUnit, 2)}
                            </td>
                            <td className="py-1 pr-3 tabular-nums text-success">
                              {formatQtyWithUnit(p.fulfilledQtyMt, t.quantityUnit, 2)}
                            </td>
                            <td className="py-1 pr-3 tabular-nums">
                              {formatQtyWithUnit(p.openQtyMt, t.quantityUnit, 2)}
                            </td>
                            <td className="py-1 tabular-nums">
                              {warehouseShareOfOrder(p.qtyMt, t.contractualQtyMt).toFixed(0)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>
            );
          })}
          <ListPagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.totalItems}
            startIndex={pagination.startIndex}
            endIndex={pagination.endIndex}
            onPageChange={pagination.setPage}
          />
        </div>
      )}
      </div>

      {closeRef && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Request trade close</h3>
                <p className="mt-1 font-mono text-xs text-subtle">{closeRef}</p>
              </div>
              <button
                type="button"
                onClick={() => setCloseRef(null)}
                className="rounded-md p-1 text-subtle hover:bg-foreground/5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Closing below the tolerance floor writes off the undelivered quantity, so it settles in
              money: price it here and the CEO approves the note along with the close.
            </p>

            {/* The debit note travels with the request — the CEO sees the same
                figures the trader entered, and approving posts them. */}
            <div className="mt-4 rounded-lg border border-dashed border-border px-4 py-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <FileMinus2 className="h-3.5 w-3.5 text-warning" />
                Debit note
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div>
                  <dt className="text-subtle">Trade rate (incl. commission)</dt>
                  <dd className="font-mono text-foreground">
                    {note ? `${fmtNum(note.ratePerMaund)} ₨/maund` : "…"}
                  </dd>
                </div>
                <div>
                  <dt className="text-subtle">Open quantity</dt>
                  <dd className="font-mono text-foreground">
                    {note
                      ? `${fmtNum(note.openQtyMt)} MT (${fmtNum(note.openMaunds)} maund)`
                      : "…"}
                  </dd>
                </div>
              </dl>
              <label className="mt-3 block">
                <span className="text-xs font-medium text-muted-foreground">
                  Settlement price (₨/maund) <span className="text-destructive">*</span>
                </span>
                <input
                  type="number"
                  min={0}
                  value={settlementPrice}
                  onChange={(e) => setSettlementPrice(e.target.value)}
                  placeholder={note ? fmtNum(note.ratePerMaund) : "0"}
                  className="kastros-input mt-1 w-full text-sm"
                />
              </label>
              {note && settlementValid && (
                <p className="mt-2 text-xs">
                  {note.amountPkr <= 0.005 ? (
                    <span className="text-subtle">
                      Settlement equals the trade rate — the trade closes with{" "}
                      <span className="text-foreground">no ledger entry</span>.
                    </span>
                  ) : note.direction === "SELLER_OWES_US" ? (
                    <span className="text-success">
                      Seller owes you {fmtNum(note.amountPkr)} PKR ({fmtNum(note.openMaunds)} maund ×{" "}
                      {fmtNum(note.diffPerMaund)}) — posts as a debit note on their receivable ledger.
                    </span>
                  ) : (
                    <span className="text-warning">
                      You owe the seller {fmtNum(note.amountPkr)} PKR ({fmtNum(note.openMaunds)} maund
                      × {fmtNum(Math.abs(note.diffPerMaund))}) — posts as a credit note on their
                      payable ledger.
                    </span>
                  )}
                </p>
              )}
            </div>

            <label className="mt-4 block text-xs text-subtle">
              Reason for closing *
              <textarea
                value={closeComment}
                onChange={(e) => setCloseComment(e.target.value)}
                rows={3}
                placeholder="Why should this trade be closed now?"
                className="kastros-input mt-1 w-full"
              />
            </label>
            {submitClose.error && (
              <p className="mt-2 text-xs text-destructive">{submitClose.error.message}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setCloseRef(null)} className="kastros-btn-secondary text-xs">
                Cancel
              </button>
              <button
                type="button"
                disabled={!closeComment.trim() || !settlementValid || !note || submitClose.isPending}
                onClick={() =>
                  submitClose.mutate({
                    department: "TRADING",
                    entityType: "TRADE",
                    entityRef: closeRef,
                    entityLabel: `Close trade ${closeRef}`,
                    action: "CLOSE",
                    comment: closeComment.trim(),
                    payload: {
                      ratePerMaund: note!.ratePerMaund,
                      settlementPricePerMaund: note!.settlementPricePerMaund,
                      diffPerMaund: note!.diffPerMaund,
                      openQtyMt: note!.openQtyMt,
                      openMaunds: note!.openMaunds,
                      amountPkr: note!.amountPkr,
                      direction: note!.direction,
                    },
                  })
                }
                className="kastros-btn-primary inline-flex items-center gap-2 text-xs disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                {submitClose.isPending ? "Sending…" : "Send to CEO"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "success" | "warning";
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-subtle">{label}</div>
      <div
        className={cn(
          "mt-1 text-2xl font-bold tabular-nums",
          accent === "success" && "text-success",
          accent === "warning" && "text-warning",
          !accent && "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}
