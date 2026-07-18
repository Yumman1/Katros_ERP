"use client";

import { fmtCapacityMt } from "@/lib/warehouse-availability";
import type { WarehouseUtilizationView } from "@/lib/warehouse-utilization";

type Props = {
  view: WarehouseUtilizationView;
  compact?: boolean;
};

/** Shared capacity stats — same numbers on Utilization page and trader booking. */
export function WarehouseCapacityStats({ view, compact }: Props) {
  const gridClass = compact ? "grid grid-cols-2 gap-2 text-xs" : "mt-3 grid grid-cols-2 gap-2 text-xs";

  return (
    <div className={compact ? "space-y-2" : undefined}>
      <p className="text-[10px] text-subtle">
        Divisions: {view.grainDivisionSqFt} sq ft / MT grain · {view.balesDivisionSqFt} sq ft / bale
      </p>
      <div className={gridClass}>
        <Stat label="On hand (MT)" value={view.stockMt.toFixed(1)} />
        <Stat label="On hand (bales)" value={view.stockBales.toLocaleString()} />
        <Stat label="Utilization" value={`${view.utilizationPct.toFixed(1)}%`} />
        <Stat label="Free sq ft" value={view.remainingSqFt.toLocaleString(undefined, { maximumFractionDigits: 0 })} />
        <Stat
          label="Avail. grain (MT)"
          value={fmtCapacityMt(view.availableGrainMt)}
          highlight
        />
        <Stat
          label="Avail. bales (MT eq.)"
          value={fmtCapacityMt(view.availableBaleAsGrainMt)}
          highlight
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border px-2 py-1.5 ${
        highlight ? "border-accent-secondary/30 bg-accent-secondary-muted/20" : "border-border bg-card"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider text-subtle">{label}</div>
      <div className={`mt-0.5 font-medium tabular-nums ${highlight ? "text-accent-secondary" : "text-muted-foreground"}`}>
        {value}
      </div>
    </div>
  );
}
