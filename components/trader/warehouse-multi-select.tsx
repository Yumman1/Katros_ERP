"use client";

import { availabilityTone, fmtCapacityMt } from "@/lib/warehouse-availability";
import type { WarehouseStorageDivision } from "@/lib/warehouse-utilization";
import { cn } from "@/lib/utils";

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
};

type Props = {
  warehouses: WarehouseOption[];
  value: string[];
  onChange: (names: string[]) => void;
  className?: string;
  loading?: boolean;
  /** When set, show capacity for this division only (grain for corn/grains, bale for cotton). */
  storageDivision?: WarehouseStorageDivision | null;
};

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

export function WarehouseMultiSelect({
  warehouses,
  value,
  onChange,
  className,
  loading,
  storageDivision = null,
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

  const divisionLabel = storageDivision ? DIVISION_LABEL[storageDivision] : null;

  return (
    <div className={cn("space-y-2", className)}>
      {warehouses.map((w) => {
        const checked = selected.has(w.name);
        const showDivisionScoped = storageDivision != null;
        const availPct = showDivisionScoped
          ? (w.divisionAvailabilityPct ?? w.availabilityPct)
          : w.availabilityPct;
        const availMt = showDivisionScoped
          ? w.divisionAvailableMt
          : w.availableGrainMt;
        const tone = availabilityTone(availPct);
        const hasCapacity = availMt != null || w.grainDivisionSqFt != null;

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
                  Bale division: {w.balesDivisionSqFt} sq ft / bale
                </p>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span
                  className={cn(
                    "rounded-full border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                    TONE_CLASS[tone],
                  )}
                  title={divisionLabel ? `${divisionLabel} availability` : undefined}
                >
                  {availPct != null ? `${availPct.toFixed(0)}% available` : "N/A"}
                </span>
                {hasCapacity ? (
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
