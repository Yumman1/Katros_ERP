"use client";

import {
  computeWarehouseCosting,
  DEFAULT_WAREHOUSE_LABOR,
  fmtPkr,
  type WarehouseLaborLine,
} from "@/lib/warehouse-costing";
import { Plus, Trash2 } from "lucide-react";

export type WarehouseCostingFormState = {
  serviceStartDate: string;
  rentalTaxPkr: string;
  managementFeePct: string;
  hiringPeriodMonths: string;
  laborLines: WarehouseLaborLine[];
};

export const emptyCostingForm = (): WarehouseCostingFormState => ({
  serviceStartDate: "",
  rentalTaxPkr: "0",
  managementFeePct: "13",
  hiringPeriodMonths: "3",
  laborLines: DEFAULT_WAREHOUSE_LABOR.map((l) => ({ ...l })),
});

export function costingFormFromLocation(loc: {
  serviceStartDate?: string | null;
  rentalTaxPkr?: number | null;
  managementFeePct?: number | null;
  hiringPeriodMonths?: number | null;
  laborLines?: WarehouseLaborLine[] | null;
}): WarehouseCostingFormState {
  return {
    serviceStartDate: loc.serviceStartDate?.slice(0, 10) ?? "",
    rentalTaxPkr: loc.rentalTaxPkr != null ? String(loc.rentalTaxPkr) : "0",
    managementFeePct: loc.managementFeePct != null ? String(loc.managementFeePct) : "13",
    hiringPeriodMonths: loc.hiringPeriodMonths != null ? String(loc.hiringPeriodMonths) : "3",
    laborLines: loc.laborLines?.length
      ? loc.laborLines.map((l) => ({ ...l }))
      : DEFAULT_WAREHOUSE_LABOR.map((l) => ({ ...l })),
  };
}

export function parseCostingForm(form: WarehouseCostingFormState) {
  return {
    serviceStartDate: form.serviceStartDate.trim() || undefined,
    rentalTaxPkr: form.rentalTaxPkr.trim() === "" ? 0 : Number(form.rentalTaxPkr),
    managementFeePct: form.managementFeePct.trim() === "" ? 0 : Number(form.managementFeePct),
    hiringPeriodMonths: form.hiringPeriodMonths.trim() === "" ? undefined : Number(form.hiringPeriodMonths),
    laborLines: form.laborLines.map((l) => ({
      role: l.role.trim(),
      headcount: Number(l.headcount) || 0,
      unitCostPkr: Number(l.unitCostPkr) || 0,
    })),
  };
}

type Props = {
  costing: WarehouseCostingFormState;
  onChange: (next: WarehouseCostingFormState) => void;
};

export function WarehouseCostingFields({
  costing,
  onChange,
}: Props) {
  function patch(partial: Partial<WarehouseCostingFormState>) {
    onChange({ ...costing, ...partial });
  }

  function updateLabor(index: number, field: keyof WarehouseLaborLine, value: string) {
    const laborLines = costing.laborLines.map((line, i) => {
      if (i !== index) return line;
      if (field === "role") return { ...line, role: value };
      return { ...line, [field]: value === "" ? 0 : Number(value) };
    });
    patch({ laborLines });
  }

  return (
    <div className="space-y-4 border-t border-border pt-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Fixed cost — warehousing service</h3>
        <p className="mt-0.5 text-xs text-subtle">
          Rental, labor, and management fee — used for utilization and per-maund costing analysis.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <label className="block text-xs text-subtle">
          Service start date
          <input
            type="date"
            value={costing.serviceStartDate}
            onChange={(e) => patch({ serviceStartDate: e.target.value })}
            className="kastros-input mt-1 w-full"
          />
        </label>
        <label className="block text-xs text-subtle">
          Estimated tax on rental (PKR / month)
          <input
            type="number"
            min={0}
            value={costing.rentalTaxPkr}
            onChange={(e) => patch({ rentalTaxPkr: e.target.value })}
            className="kastros-input mt-1 w-full"
          />
        </label>
        <label className="block text-xs text-subtle">
          Management fee (%)
          <input
            type="number"
            min={0}
            step={0.1}
            value={costing.managementFeePct}
            onChange={(e) => patch({ managementFeePct: e.target.value })}
            className="kastros-input mt-1 w-full"
          />
        </label>
        <label className="block text-xs text-subtle">
          Hiring period (months)
          <input
            type="number"
            min={1}
            value={costing.hiringPeriodMonths}
            onChange={(e) => patch({ hiringPeriodMonths: e.target.value })}
            className="kastros-input mt-1 w-full"
          />
        </label>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Fixed labor cost</span>
          <button
            type="button"
            onClick={() =>
              patch({
                laborLines: [...costing.laborLines, { role: "Other", headcount: 0, unitCostPkr: 0 }],
              })
            }
            className="inline-flex items-center gap-1 text-[11px] font-medium text-accent-secondary hover:underline"
          >
            <Plus className="h-3 w-3" />
            Add role
          </button>
        </div>
        <div className="kastros-table-wrap">
          <table className="kastros-table text-xs">
            <thead>
              <tr>
                {["Role", "Headcount", "Unit cost (PKR / month)", "Amount (PKR / month)", ""].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {costing.laborLines.map((line, i) => {
                const amount = (Number(line.headcount) || 0) * (Number(line.unitCostPkr) || 0);
                return (
                  <tr key={`${line.role}-${i}`}>
                    <td>
                      <input
                        value={line.role}
                        onChange={(e) => updateLabor(i, "role", e.target.value)}
                        className="kastros-input w-full min-w-[140px]"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        value={line.headcount}
                        onChange={(e) => updateLabor(i, "headcount", e.target.value)}
                        className="kastros-input w-20"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        value={line.unitCostPkr}
                        onChange={(e) => updateLabor(i, "unitCostPkr", e.target.value)}
                        className="kastros-input w-28"
                      />
                    </td>
                    <td className="tabular-nums text-muted-foreground">{fmtPkr(amount)}</td>
                    <td>
                      {costing.laborLines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => patch({ laborLines: costing.laborLines.filter((_, j) => j !== i) })}
                          className="text-subtle hover:text-destructive"
                          aria-label="Remove role"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function WarehouseCostingSummaryCard({
  loc,
  actualUtilPct,
  stockMt,
}: {
  loc: {
    capacitySqFt?: number | null;
    costPerSqFt?: number | null;
    rentalPerSqFtMonth?: number | null;
    grainDivisionSqFt?: number | null;
    rentalTaxPkr?: number | null;
    laborLines?: WarehouseLaborLine[] | null;
    managementFeePct?: number | null;
    hiringPeriodMonths?: number | null;
    serviceStartDate?: string | null;
  };
  actualUtilPct?: number | null;
  stockMt?: number;
}) {
  const summary = computeWarehouseCosting({
    capacitySqFt: loc.capacitySqFt,
    grainDivisionSqFt: loc.grainDivisionSqFt,
    rentalPerSqFtMonth: loc.rentalPerSqFtMonth ?? loc.costPerSqFt,
    rentalTaxPkr: loc.rentalTaxPkr,
    laborLines: loc.laborLines,
    managementFeePct: loc.managementFeePct,
  });

  if (!summary) return null;

  const actualMaunds = (stockMt ?? 0) * 25;
  const costPerMaundActual =
    actualMaunds > 0 && actualUtilPct != null && actualUtilPct > 0
      ? summary.totalCostPkr / actualMaunds
      : null;

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-subtle">Monthly costing</div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat label="Total cost" value={fmtPkr(summary.totalCostPkr)} />
        <Stat label="Loaded / sq ft" value={fmtPkr(summary.loadedCostPerSqFtPkr, 2)} />
        <Stat label="Cost / maund @ 70%" value={fmtPkr(summary.costPerMaundAt70PctPkr, 2)} />
        <Stat label="Cost / maund @ 100%" value={fmtPkr(summary.costPerMaundAt100PctPkr, 2)} />
        {costPerMaundActual != null && (
          <Stat label="Cost / maund (actual stock)" value={fmtPkr(costPerMaundActual, 2)} />
        )}
      </div>
      {loc.hiringPeriodMonths && (
        <p className="text-[10px] text-subtle">Hire period: {loc.hiringPeriodMonths} months</p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-subtle">{label}</div>
      <div className="mt-0.5 font-medium tabular-nums text-muted-foreground">{value}</div>
    </div>
  );
}
