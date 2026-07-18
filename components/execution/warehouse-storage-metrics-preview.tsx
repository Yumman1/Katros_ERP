"use client";

import {
  computeWarehouseCosting,
  fmtCostPerMaund,
  fmtStorageMt,
  storageMetricsFromWarehousePayload,
  type WarehouseCostingInput,
  type WarehouseCostingSummary,
} from "@/lib/warehouse-costing";

const METRICS: {
  key: keyof Pick<
    WarehouseCostingSummary,
    "storageCapacityMt" | "storageAt70PctMt" | "costPerMaundAt70PctPkr" | "costPerMaundAt100PctPkr"
  >;
  label: string;
  format: (summary: WarehouseCostingSummary) => string;
}[] = [
  {
    key: "storageCapacityMt",
    label: "Total Storage Capacity",
    format: (s) => fmtStorageMt(s.storageCapacityMt),
  },
  {
    key: "storageAt70PctMt",
    label: "Storage Capacity at 70% Utilisation (M)",
    format: (s) => fmtStorageMt(s.storageAt70PctMt),
  },
  {
    key: "costPerMaundAt70PctPkr",
    label: "Total Storage Cost Per Maund / Month (PKR.) at 70% Utilisation",
    format: (s) => fmtCostPerMaund(s.costPerMaundAt70PctPkr),
  },
  {
    key: "costPerMaundAt100PctPkr",
    label: "Total Storage Cost Per Maund / Month (PKR.) at 100% Utilisation",
    format: (s) => fmtCostPerMaund(s.costPerMaundAt100PctPkr),
  },
];

type Props =
  | { summary: WarehouseCostingSummary | null; input?: never; payload?: never }
  | { input: WarehouseCostingInput; summary?: never; payload?: never }
  | { payload: Record<string, unknown>; summary?: never; input?: never };

export function WarehouseStorageMetricsPreview(props: Props) {
  const summary =
    "summary" in props && props.summary != null
      ? props.summary
      : "input" in props && props.input
        ? computeWarehouseCosting(props.input)
        : "payload" in props && props.payload
          ? storageMetricsFromWarehousePayload(props.payload)
          : null;

  if (!summary) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-black/10 px-4 py-3 text-xs text-subtle">
        Enter capacity (sq ft), rental rate, and grain division to calculate storage metrics.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-accent-secondary/30 bg-accent-secondary-muted/10 p-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-accent-secondary">
        Storage metrics (live)
      </h4>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {METRICS.map(({ key, label, format }) => (
          <div key={key} className="rounded-lg border border-border bg-card px-3 py-2.5">
            <div className="text-[10px] leading-snug text-subtle">{label}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{format(summary)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
