"use client";

import { SearchableSelect } from "@/components/ui/searchable-select";

import type { TradeParamDefinition } from "@/lib/trade-parameters";
import { formInputClass, formSelectClass } from "@/lib/form-controls";

export function ParamField({
  def,
  value,
  onChange,
}: {
  def: TradeParamDefinition;
  value: string | number | null | undefined;
  onChange: (key: string, value: string) => void;
}) {
  const strVal = value == null ? "" : String(value);

  const label = (
    <label className="mb-1 block text-xs text-muted-foreground">
      {def.label}
      {def.unit && !def.label.toLowerCase().includes(def.unit.toLowerCase()) ? ` (${def.unit})` : ""}
    </label>
  );

  if (def.type === "select" && def.options) {
    return (
      <div>
        {label}
        <SearchableSelect value={strVal} onChange={(e) => onChange(def.key, e.target.value)} className={formSelectClass}>
          <option value="">—</option>
          {def.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </SearchableSelect>
      </div>
    );
  }

  if (def.type === "textarea") {
    return (
      <div>
        {label}
        <textarea
          rows={2}
          value={strVal}
          placeholder={def.placeholder}
          onChange={(e) => onChange(def.key, e.target.value)}
          className={formInputClass}
        />
      </div>
    );
  }

  return (
    <div>
      {label}
      <input
        type={def.type === "date" ? "date" : def.type === "number" || def.type === "percent" ? "number" : "text"}
        inputMode={def.type === "number" || def.type === "percent" ? "decimal" : undefined}
        value={strVal}
        placeholder={def.placeholder}
        onChange={(e) => onChange(def.key, e.target.value)}
        className={`${formInputClass} ${def.type === "number" || def.type === "percent" ? "data-grid" : ""}`}
      />
    </div>
  );
}
