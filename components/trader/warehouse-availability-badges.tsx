"use client";

import { availabilityTone, fmtCapacityMt } from "@/lib/warehouse-availability";
import type { WarehouseStorageDivision } from "@/lib/warehouse-utilization";
import type { WarehouseOption } from "@/components/trader/warehouse-multi-select";
import { cn } from "@/lib/utils";
import { TradeDirection } from "@prisma/client";

const TONE_CLASS = {
  high: "border-success/40 bg-success/10 text-success",
  medium: "border-warning/40 bg-warning/10 text-warning",
  low: "border-destructive/40 bg-destructive/10 text-destructive",
  unknown: "border-kastros-border bg-foreground/[0.04] text-subtle",
} as const;

const DIVISION_LABEL: Record<WarehouseStorageDivision, string> = {
  grain: "grain division",
  bale: "bale division",
};

function fmtMt(n: number) {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/** Shared by booking and execution review; figures come from the same query. */
export function WarehouseAvailabilityBadges({
  warehouse: w,
  bookingDirection = TradeDirection.BUY,
  storageDivision = null,
  requestedQtyMt = 0,
}: {
  warehouse: WarehouseOption;
  bookingDirection?: TradeDirection;
  storageDivision?: WarehouseStorageDivision | null;
  requestedQtyMt?: number;
}) {
  const divisionLabel = storageDivision ? DIVISION_LABEL[storageDivision] : null;
  const isSell = bookingDirection === TradeDirection.SELL;
  const showDivisionScoped = storageDivision != null;
  const availMt = showDivisionScoped
    ? w.divisionAvailableMt
    : w.availableGrainMt;
  const hasCapacity = availMt != null || w.grainDivisionSqFt != null;

  const freeMt = w.trueAvailableMt ?? availMt;
  const freePct =
    w.trueAvailabilityPct ??
    (showDivisionScoped ? w.divisionAvailabilityPct : w.availabilityPct);

  const stockMt = w.stockOnHandMt ?? 0;
  const bookedMt = w.bookedQtyMt ?? 0;
  const freeToSellMt = w.freeToSellMt ?? Math.max(0, stockMt - bookedMt);
  // Red once the pick cannot cover what is being booked; a warehouse with
  // nothing left to sell reads red even before a quantity is entered.
  const freeTone =
    freeToSellMt <= 0
      ? "low"
      : requestedQtyMt > 0 && freeToSellMt < requestedQtyMt
        ? "low"
        : "high";

  const badgeMt = freeMt;
  const badgePct = freePct;
  const badgeTone = availabilityTone(freePct);
  const badgeTitle = divisionLabel
    ? `${divisionLabel} — spare storage capacity`
    : "Spare storage capacity";

  if (isSell && (w.stockOnHandMt == null || w.bookedQtyMt == null)) {
    return <p className="mt-1.5 text-xs text-subtle">Stock availability unavailable</p>;
  }
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {isSell ? (
        <>
          <span
            className={cn(
              "rounded-full border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
              TONE_CLASS.unknown,
            )}
            title="Physical stock on hand for this commodity"
          >
            Stock {fmtMt(stockMt)} MT
          </span>
          <span
            className={cn(
              "rounded-full border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
              bookedMt > 0 ? TONE_CLASS.medium : TONE_CLASS.unknown,
            )}
            title="Already sold on open contracts from this warehouse, not lifted yet"
          >
            Booked {fmtMt(bookedMt)} MT
          </span>
          <span
            className={cn(
              "rounded-full border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
              TONE_CLASS[freeTone],
            )}
            title="Stock on hand minus booked — what is still free to sell"
          >
            Free to sell {fmtMt(freeToSellMt)} MT
          </span>
        </>
      ) : badgeMt != null ? (
        <span
          className={cn(
            "rounded-full border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
            TONE_CLASS[badgeTone],
          )}
          title={badgeTitle}
        >
          Available {fmtMt(badgeMt)} MT
          {badgePct != null ? ` · ${badgePct.toFixed(0)}%` : ""}
        </span>
      ) : hasCapacity ? (
        <span
          className="rounded-full border border-kastros-border bg-foreground/[0.04] px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground"
          title={
            storageDivision === "grain"
              ? "Free grain capacity (MT)"
              : storageDivision === "bale"
                ? "Free bale capacity as MT equivalent"
                : "Free grain capacity (MT)"
          }
        >
          {fmtCapacityMt(availMt)} MT
        </span>
      ) : (
        <span className="text-[10px] text-subtle">
          Set capacity & divisions on Warehouses → Setup
        </span>
      )}
    </div>
  );
}
