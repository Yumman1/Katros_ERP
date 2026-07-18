"use client";

import type { TradeParamValues } from "@/lib/trade-parameters";
import { cn } from "@/lib/utils";

type Mode = "percent" | "quantity";

type Props = {
  values: TradeParamValues;
  quantityUnit?: string;
  onChange: (key: string, value: string) => void;
  readOnly?: boolean;
};

function resolveMode(values: TradeParamValues): Mode {
  const raw = values.quantityToleranceMode;
  if (raw === "percent" || raw === "quantity") return raw;
  return "percent";
}

/** Builds the trade-file tolerance string from mode + value. */
export function formatQuantityTolerance(
  values: TradeParamValues,
  quantityUnit = "MT",
): string | undefined {
  const mode = resolveMode(values);
  const raw = values.quantityToleranceValue;
  if (raw == null || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(String(raw));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  if (mode === "quantity") {
    return `+/- ${n} ${quantityUnit}`;
  }
  return `+/- ${n}%`;
}

export function QuantityToleranceField({
  values,
  quantityUnit = "MT",
  onChange,
  readOnly = false,
}: Props) {
  const mode = resolveMode(values);
  const strVal = values.quantityToleranceValue == null ? "" : String(values.quantityToleranceValue);

  return (
    <div className="sm:col-span-2">
      <label className="mb-1 block text-xs text-muted-foreground">Quantity tolerance</label>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
          <button
            type="button"
            disabled={readOnly}
            onClick={() => onChange("quantityToleranceMode", "percent")}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              mode === "percent"
                ? "bg-brand text-white"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Percent %
          </button>
          <button
            type="button"
            disabled={readOnly}
            onClick={() => onChange("quantityToleranceMode", "quantity")}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              mode === "quantity"
                ? "bg-brand text-white"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Direct qty
          </button>
        </div>
        <input
          type="number"
          min={0}
          step={mode === "percent" ? "0.01" : "0.001"}
          value={strVal}
          readOnly={readOnly}
          placeholder={mode === "percent" ? "e.g. 5" : `e.g. 100 ${quantityUnit}`}
          onChange={(e) => onChange("quantityToleranceValue", e.target.value)}
          className="kastros-input kastros-input-sm w-36 data-grid"
        />
        <span className="text-xs text-muted-foreground">
          {mode === "percent" ? "% of contract quantity" : quantityUnit}
        </span>
      </div>
      {strVal && Number(strVal) > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          Saved as: {formatQuantityTolerance({ ...values, quantityToleranceValue: strVal }, quantityUnit)}
        </p>
      )}
    </div>
  );
}
