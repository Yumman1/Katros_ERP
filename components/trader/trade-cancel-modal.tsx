"use client";

import {
  traderCanCancelTrade,
  traderCancelBlockedReason,
  traderCancelNeedsDebitNote,
} from "@/lib/trade-lifecycle";
import { trpc } from "@/lib/trpc/client";
import { AlertTriangle, FileMinus2, X } from "lucide-react";
import { useEffect, useState } from "react";

const fmt = (n: number) => n.toLocaleString("en-PK", { maximumFractionDigits: 2 });

export function TradeCancelModal({
  tradeRef,
  open,
  onClose,
}: {
  tradeRef: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [settlementPrice, setSettlementPrice] = useState("");
  const [sentToCeo, setSentToCeo] = useState(false);
  const utils = trpc.useUtils();

  const { data: trade, isLoading } = trpc.trader.tradeByRef.useQuery(
    { tradeRef: tradeRef ?? "" },
    { enabled: open && !!tradeRef },
  );

  const needsNote = trade ? traderCancelNeedsDebitNote(trade) : false;
  const settlementNum = Number(settlementPrice);
  const settlementValid = Number.isFinite(settlementNum) && settlementNum > 0;

  // Debit-note preview: rate + open qty on load, live amount once a price is in.
  const { data: preview } = trpc.trader.cancellationPreview.useQuery(
    {
      tradeRef: tradeRef ?? "",
      settlementPricePerMaund: settlementValid ? settlementNum : undefined,
    },
    { enabled: open && !!tradeRef && needsNote },
  );

  const cancelTrade = trpc.trader.cancelTrade.useMutation({
    onSuccess: async (res) => {
      await Promise.all([
        utils.trader.myTrades.invalidate(),
        utils.trader.myCancelledCount.invalidate(),
        utils.trader.deskSummary.invalidate(),
        utils.trader.actionItems.invalidate(),
      ]);
      if (res.pendingCeo) {
        setSentToCeo(true); // keep the modal up to say so
      } else {
        onClose();
      }
    },
  });

  // Reset the form each time the modal is opened for a different trade.
  useEffect(() => {
    if (open) {
      setReason("");
      setSettlementPrice("");
      setSentToCeo(false);
      cancelTrade.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tradeRef]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !tradeRef) return null;

  const canCancel = trade ? traderCanCancelTrade(trade) : false;
  const blockedReason = trade ? traderCancelBlockedReason(trade) : null;
  const reasonOk = reason.trim().length >= 3;
  const submitDisabled = cancelTrade.isPending || !reasonOk || (needsNote && !settlementValid);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-10"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg rounded-xl border border-kastros-border bg-kastros-bg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-kastros-border px-5 py-3">
          <div>
            <h2 className="font-mono text-sm font-semibold text-foreground">{tradeRef}</h2>
            <p className="text-xs text-subtle">
              {needsNote ? "Cancel locked trade — debit note" : "Cancel trade"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-subtle hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5">
          {isLoading || !trade ? (
            <div className="animate-pulse py-8 text-center text-sm text-subtle">Loading trade…</div>
          ) : sentToCeo ? (
            <div className="rounded-lg border border-kastros-border bg-kastros-card px-4 py-6 text-center">
              <p className="text-sm font-semibold text-foreground">Sent to the CEO for approval</p>
              <p className="mt-2 text-xs text-subtle">
                The trade stays locked until the CEO approves. On approval it moves to Cancelled
                {preview && preview.amountPkr > 0.005
                  ? ` and a ${preview.direction === "SELLER_OWES_US" ? "debit" : "credit"} note of ${fmt(preview.amountPkr)} PKR posts to ${trade.counterparty.name}'s ledger.`
                  : " with no ledger entry — the settlement price equals the trade rate."}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-4 rounded-md border border-kastros-border px-4 py-2 text-sm text-muted-foreground hover:bg-foreground/5"
              >
                Done
              </button>
            </div>
          ) : !canCancel ? (
            <div className="rounded-lg border border-kastros-border bg-kastros-card px-4 py-6 text-center text-sm text-subtle">
              {blockedReason ?? "This trade can no longer be cancelled."}
            </div>
          ) : (
            <>
              <div className="flex gap-3 rounded-lg border border-kastros-red/30 bg-kastros-red/10 px-4 py-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-kastros-red" />
                <div className="text-xs text-muted-foreground">
                  <p className="font-semibold text-kastros-red">
                    {needsNote ? "Cancellation needs CEO approval." : "This cannot be undone."}
                  </p>
                  <p className="mt-1">
                    {needsNote
                      ? "This trade is locked, so cancelling settles in money: enter the settlement price and the difference on the open quantity posts to the seller's ledger once the CEO approves."
                      : "The trade moves to Cancelled and leaves the execution queue. It can no longer be edited, priced, or locked."}
                  </p>
                </div>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div>
                  <dt className="text-subtle">Counterparty</dt>
                  <dd className="text-foreground">{trade.counterparty.name}</dd>
                </div>
                <div>
                  <dt className="text-subtle">Commodity</dt>
                  <dd className="text-foreground">{trade.commodity.code}</dd>
                </div>
                <div>
                  <dt className="text-subtle">Side</dt>
                  <dd className="text-foreground">{trade.direction}</dd>
                </div>
                <div>
                  <dt className="text-subtle">Quantity</dt>
                  <dd className="text-foreground">
                    {trade.quantity} {trade.quantityUnit ?? trade.commodity.unit}
                  </dd>
                </div>
              </dl>

              {needsNote && (
                <div className="mt-4 rounded-lg border border-dashed border-kastros-border px-4 py-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <FileMinus2 className="h-3.5 w-3.5 text-warning" />
                    Debit note
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <div>
                      <dt className="text-subtle">Trade rate (incl. commission)</dt>
                      <dd className="font-mono text-foreground">
                        {preview ? `${fmt(preview.ratePerMaund)} ₨/maund` : "…"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-subtle">Open quantity</dt>
                      <dd className="font-mono text-foreground">
                        {preview
                          ? `${fmt(preview.openQtyMt)} MT (${fmt(preview.openMaunds)} maund)`
                          : "…"}
                      </dd>
                    </div>
                  </dl>
                  <label className="mt-3 block">
                    <span className="text-xs font-medium text-muted-foreground">
                      Settlement price (₨/maund) <span className="text-kastros-red">*</span>
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={settlementPrice}
                      onChange={(e) => setSettlementPrice(e.target.value)}
                      placeholder={preview ? fmt(preview.ratePerMaund) : "0"}
                      className="kastros-input mt-1 w-full text-sm"
                    />
                  </label>
                  {preview && settlementValid && (
                    <p className="mt-2 text-xs">
                      {preview.amountPkr <= 0.005 ? (
                        <span className="text-subtle">
                          Settlement equals the trade rate — the trade cancels with{" "}
                          <span className="text-foreground">no ledger entry</span>.
                        </span>
                      ) : preview.direction === "SELLER_OWES_US" ? (
                        <span className="text-success">
                          Seller owes you {fmt(preview.amountPkr)} PKR ({fmt(preview.openMaunds)}{" "}
                          maund × {fmt(preview.diffPerMaund)}) — posts as a debit note on their
                          receivable ledger.
                        </span>
                      ) : (
                        <span className="text-warning">
                          You owe the seller {fmt(preview.amountPkr)} PKR ({fmt(preview.openMaunds)}{" "}
                          maund × {fmt(Math.abs(preview.diffPerMaund))}) — posts as a credit note on
                          their payable ledger.
                        </span>
                      )}
                    </p>
                  )}
                </div>
              )}

              <label className="mt-4 block">
                <span className="text-xs font-medium text-muted-foreground">
                  Reason for cancelling <span className="text-kastros-red">*</span>
                </span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="e.g. Counterparty withdrew, duplicate booking, price no longer viable…"
                  className="kastros-input mt-1 w-full resize-none text-sm"
                />
              </label>

              {cancelTrade.error && (
                <p className="mt-2 text-xs text-kastros-red">{cancelTrade.error.message}</p>
              )}

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-kastros-border px-4 py-2 text-sm text-muted-foreground hover:bg-foreground/5"
                >
                  Keep trade
                </button>
                <button
                  type="button"
                  disabled={submitDisabled}
                  onClick={() =>
                    cancelTrade.mutate({
                      tradeRef,
                      reason: reason.trim(),
                      ...(needsNote && settlementValid
                        ? { settlementPricePerMaund: settlementNum }
                        : {}),
                    })
                  }
                  className="rounded-md bg-kastros-red px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {cancelTrade.isPending
                    ? "Submitting…"
                    : needsNote
                      ? "Send to CEO"
                      : "Cancel trade"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
