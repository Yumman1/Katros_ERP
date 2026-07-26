"use client";

import { traderCanCancelTrade, traderCancelBlockedReason } from "@/lib/trade-lifecycle";
import { trpc } from "@/lib/trpc/client";
import { AlertTriangle, X } from "lucide-react";
import { useEffect, useState } from "react";

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
  const utils = trpc.useUtils();

  const { data: trade, isLoading } = trpc.trader.tradeByRef.useQuery(
    { tradeRef: tradeRef ?? "" },
    { enabled: open && !!tradeRef },
  );

  const cancelTrade = trpc.trader.cancelTrade.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.trader.myTrades.invalidate(),
        utils.trader.myCancelledCount.invalidate(),
        utils.trader.deskSummary.invalidate(),
        utils.trader.actionItems.invalidate(),
      ]);
      onClose();
    },
  });

  // Reset the form each time the modal is opened for a different trade.
  useEffect(() => {
    if (open) {
      setReason("");
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
            <p className="text-xs text-subtle">Cancel trade</p>
          </div>
          <button type="button" onClick={onClose} className="text-subtle hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5">
          {isLoading || !trade ? (
            <div className="animate-pulse py-8 text-center text-sm text-subtle">Loading trade…</div>
          ) : !canCancel ? (
            <div className="rounded-lg border border-kastros-border bg-kastros-card px-4 py-6 text-center text-sm text-subtle">
              {blockedReason ?? "This trade can no longer be cancelled."}
            </div>
          ) : (
            <>
              <div className="flex gap-3 rounded-lg border border-kastros-red/30 bg-kastros-red/10 px-4 py-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-kastros-red" />
                <div className="text-xs text-muted-foreground">
                  <p className="font-semibold text-kastros-red">This cannot be undone.</p>
                  <p className="mt-1">
                    The trade moves to <span className="text-foreground">Cancelled</span> and leaves
                    the execution queue. It can no longer be edited, priced, or locked.
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
                  disabled={reason.trim().length < 3 || cancelTrade.isPending}
                  onClick={() => cancelTrade.mutate({ tradeRef, reason: reason.trim() })}
                  className="rounded-md bg-kastros-red px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {cancelTrade.isPending ? "Cancelling…" : "Cancel trade"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
