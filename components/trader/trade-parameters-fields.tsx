"use client";

import { SearchableSelect } from "@/components/ui/searchable-select";

import { useState } from "react";
import type { TradeParamDefinition, TradeParamGroup, TradeParamValues } from "@/lib/trade-parameters";
import { ParamField } from "@/components/trader/param-field";

type Props = {
  definitions: TradeParamDefinition[];
  values: TradeParamValues;
  onChange: (key: string, value: string) => void;
  onAddCustomParam?: (def: TradeParamDefinition) => void;
  showAddCustom?: boolean;
  emptyMessage?: string;
};

/** Commodity-specific quality / logistics fields only. */
export function TradeParametersFields({
  definitions,
  values,
  onChange,
  onAddCustomParam,
  showAddCustom,
  emptyMessage,
}: Props) {
  if (definitions.length === 0 && !showAddCustom) {
    return emptyMessage ? <p className="text-xs text-subtle">{emptyMessage}</p> : null;
  }

  const groups = definitions.reduce(
    (acc, d) => {
      acc[d.group] = acc[d.group] ?? [];
      acc[d.group].push(d);
      return acc;
    },
    {} as Record<TradeParamGroup, TradeParamDefinition[]>,
  );

  const groupOrder: TradeParamGroup[] = ["quality", "logistics", "contract", "commercial"];

  return (
    <div className="space-y-4">
      {groupOrder.map((group) => {
        const defs = groups[group];
        if (!defs?.length) return null;
        return (
          <div key={group} className="grid gap-3 sm:grid-cols-2">
            {defs.map((def) => (
              <ParamField key={def.key} def={def} value={values[def.key]} onChange={onChange} />
            ))}
          </div>
        );
      })}

      {showAddCustom && onAddCustomParam && (
        <AddCustomParamForm onAdd={onAddCustomParam} existingKeys={new Set(definitions.map((d) => d.key))} />
      )}
    </div>
  );
}

function AddCustomParamForm({
  onAdd,
  existingKeys,
}: {
  onAdd: (def: TradeParamDefinition) => void;
  existingKeys: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<TradeParamDefinition["type"]>("text");

  return (
    <div className="border-t border-kastros-border/40 pt-3">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="text-xs text-success hover:underline">
          + Add custom field for this trade
        </button>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <input
            placeholder="Field label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="min-w-[140px] flex-1 rounded-md border border-kastros-border bg-kastros-bg px-2 py-1.5 text-sm text-foreground"
          />
          <SearchableSelect
            value={type}
            onChange={(e) => setType(e.target.value as TradeParamDefinition["type"])}
            className="kastros-select kastros-select-sm"
          >
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="percent">Percent</option>
            <option value="select">Dropdown</option>
          </SearchableSelect>
          <button
            type="button"
            disabled={!label.trim()}
            onClick={() => {
              const key =
                "custom_" +
                label
                  .trim()
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "_")
                  .replace(/^_|_$/g, "");
              if (existingKeys.has(key)) return;
              onAdd({ key, label: label.trim(), type, group: "quality" });
              setLabel("");
              setOpen(false);
            }}
            className="rounded-md bg-success/20 px-3 py-1.5 text-xs font-medium text-success disabled:opacity-40"
          >
            Add
          </button>
          <button type="button" onClick={() => setOpen(false)} className="text-xs text-subtle hover:text-foreground">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
