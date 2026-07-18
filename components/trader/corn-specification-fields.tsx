"use client";

import type { QualityTolerances } from "@/lib/trade-constants";
import { DEFAULT_QUALITY_TOLERANCES } from "@/lib/trade-constants";

const FIELDS: { key: keyof QualityTolerances; label: string }[] = [
  { key: "damagePct", label: "Damage" },
  { key: "brokenPct", label: "Broken" },
  { key: "fungusPct", label: "Fungus" },
  { key: "foreignMatterPct", label: "Foreign matters (inc dust)" },
  { key: "moisturePct", label: "Moisture" },
];

export function defaultCornSpecifications(): QualityTolerances {
  return { ...DEFAULT_QUALITY_TOLERANCES };
}

export function CornSpecificationFields({
  values,
  onChange,
  readOnly = false,
}: {
  values: QualityTolerances;
  onChange: (next: QualityTolerances) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {FIELDS.map(({ key, label }) => (
        <label key={key} className="block text-xs text-subtle">
          {label} (%)
          <div className="relative mt-1">
            <input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={values[key]}
              readOnly={readOnly}
              onChange={(e) => {
                if (readOnly) return;
                const n = e.target.value === "" ? 0 : Number(e.target.value);
                onChange({ ...values, [key]: Number.isFinite(n) ? n : 0 });
              }}
              className={`kastros-input w-full pr-8 data-grid ${readOnly ? "opacity-80" : ""}`}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-subtle">
              %
            </span>
          </div>
        </label>
      ))}
    </div>
  );
}
