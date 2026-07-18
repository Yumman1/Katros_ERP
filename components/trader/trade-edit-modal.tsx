"use client";

import { TradeChangeForm } from "@/components/trader/trade-change-form";
import { isTraderDraft, traderCanEditTrade } from "@/lib/trade-lifecycle";
import { trpc } from "@/lib/trpc/client";
import { X } from "lucide-react";
import { useEffect } from "react";

export function TradeEditModal({
  tradeRef,
  open,
  onClose,
}: {
  tradeRef: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { data: trade, isLoading } = trpc.trader.tradeByRef.useQuery(
    { tradeRef: tradeRef ?? "" },
    { enabled: open && !!tradeRef },
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !tradeRef) return null;

  const canEdit = trade ? traderCanEditTrade(trade) : false;
  const mode = trade && isTraderDraft(trade) ? "direct" : "ceo";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-10"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl rounded-xl border border-kastros-border bg-kastros-bg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-kastros-border px-5 py-3">
          <div>
            <h2 className="font-mono text-sm font-semibold text-foreground">{tradeRef}</h2>
            <p className="text-xs text-subtle">
              {mode === "direct" ? "Draft — save directly" : "Requires CEO approval"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-subtle hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-5">
          {isLoading || !trade ? (
            <div className="animate-pulse py-8 text-center text-sm text-subtle">Loading trade…</div>
          ) : !canEdit ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              This trade is locked. Price, quantity, and commission cannot be edited.
            </div>
          ) : (
            <TradeChangeForm trade={trade} mode={mode} embedded onDone={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}
