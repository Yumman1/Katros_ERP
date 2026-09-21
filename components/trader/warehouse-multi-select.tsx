"use client";

import { WarehouseAvailabilityBadges } from "@/components/trader/warehouse-availability-badges";
import type { WarehouseStorageDivision } from "@/lib/warehouse-utilization";
import { cn } from "@/lib/utils";
import { TradeDirection } from "@prisma/client";

export type WarehouseOption = {
  id: string;
  name: string;
  code?: string | null;
  availabilityPct?: number | null;
  grainDivisionSqFt?: number | null;
  balesDivisionSqFt?: number | null;
  availableGrainMt?: number | null;
  availableBaleAsGrainMt?: number | null;
  storageDivision?: WarehouseStorageDivision | null;
  divisionAvailabilityPct?: number | null;
  divisionAvailableMt?: number | null;
  /** True free space: max(0, capacity − all physical inventory). */
  trueAvailableMt?: number | null;
  /** trueAvailableMt as a % of capacity. */
  trueAvailabilityPct?: number | null;
  /** Physical stock on hand (MT) for the booked commodity. */
  stockOnHandMt?: number | null;
  /** Open sell commitment (MT) at this warehouse that has not been dispatched yet. */
  bookedQtyMt?: number | null;
  /** max(0, stockOnHandMt − bookedQtyMt) — stock not already promised out. */
  freeToSellMt?: number | null;
  /** Division capacity (MT) — used for sell stock % when configured. */
  capacityMt?: number | null;
};

type Props = {
  warehouses: WarehouseOption[];
  value: string[];
  onChange: (names: string[]) => void;
  className?: string;
  loading?: boolean;
  /** When set, show capacity for this division only (grain for corn/grains, bale for cotton). */
  storageDivision?: WarehouseStorageDivision | null;
  /** BUY = spare storage capacity; SELL = physical stock on hand. */
  bookingDirection?: TradeDirection;
  /** Quantity being booked (MT) — colours the sell-side free-to-sell badge. */
  requestedQtyMt?: number;
};

export function WarehouseMultiSelect({
  warehouses,
  value,
  onChange,
  className,
  loading,
  storageDivision = null,
  bookingDirection = TradeDirection.BUY,
  requestedQtyMt = 0,
}: Props) {
  const selected = new Set(value.map((v) => v.trim()).filter(Boolean));

  function toggle(name: string) {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange([...next]);
  }

  if (loading) {
    return <p className="text-xs text-subtle">Loading warehouse availability…</p>;
  }

  if (!warehouses.length) {
    return (
      <p className="text-xs text-subtle">
        No warehouses registered yet — execution head can assign after lock.
      </p>
    );
  }


  return (
    <div className={cn("space-y-2", className)}>
      {warehouses.map((w) => {
        const checked = selected.has(w.name);
        const showDivisionScoped = storageDivision != null;

        return (
          <label
            key={w.id}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-xs transition-colors",
              checked
                ? "border-success/50 bg-success/10 text-foreground"
                : "border-kastros-border text-muted-foreground hover:bg-foreground/[0.02]",
            )}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(w.name)}
              className="mt-0.5 accent-brand"
            />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-foreground">
                {w.name}
                {w.code ? <span className="font-normal text-subtle"> ({w.code})</span> : null}
              </div>
              {showDivisionScoped && w.grainDivisionSqFt != null && storageDivision === "grain" && (
                <p className="mt-0.5 text-[10px] text-subtle">
                  Grain division: {w.grainDivisionSqFt} sq ft / MT
                </p>
              )}
              {showDivisionScoped && w.balesDivisionSqFt != null && storageDivision === "bale" && (
                <p className="mt-0.5 text-[10px] text-subtle">
                  Bale division: {w.balesDivisionSqFt} sq ft / MT
                </p>
              )}
              <WarehouseAvailabilityBadges
                warehouse={w}
                bookingDirection={bookingDirection}
                storageDivision={storageDivision}
                requestedQtyMt={requestedQtyMt}
              />
            </div>
          </label>
        );
      })}
      {selected.size > 0 && (
        <p className="text-xs text-subtle">
          {selected.size} warehouse{selected.size === 1 ? "" : "s"} selected — execution head will
          split quantities after lock.
        </p>
      )}
    </div>
  );
}
