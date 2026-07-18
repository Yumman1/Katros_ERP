"use client";

import { TradeParametersFields } from "@/components/trader/trade-parameters-fields";
import type { CommodityFormState } from "@/lib/commodity-registration";
import {
  defaultKgPerUnit,
  PRICE_CURRENCIES,
  PRICE_CURRENCY_LABELS,
  type PriceCurrency,
} from "@/lib/price-units";
import type { TradeParamDefinition } from "@/lib/trade-parameters";

type Props = {
  value: CommodityFormState;
  onChange: (next: CommodityFormState) => void;
  quantityUnitOptions: string[];
  tradeParameterDefs: TradeParamDefinition[];
  onTradeParameterDefsChange: (defs: TradeParamDefinition[]) => void;
  unitListId?: string;
};

export function CommodityRegistrationFields({
  value,
  onChange,
  quantityUnitOptions,
  tradeParameterDefs,
  onTradeParameterDefsChange,
  unitListId = "commodity-unit-options",
}: Props) {
  return (
    <div className="space-y-2">
      <input
        placeholder="Name *"
        value={value.name}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
        className="w-full rounded-md border border-kastros-border bg-kastros-bg px-2 py-1.5 text-sm text-foreground"
      />
      <input
        placeholder="Code (3–6 chars) *"
        value={value.code}
        onChange={(e) => onChange({ ...value, code: e.target.value.toUpperCase() })}
        className="w-full rounded-md border border-kastros-border bg-kastros-bg px-2 py-1.5 text-sm text-foreground"
      />
      <label className="text-xs text-subtle">Canonical quantity unit (stored as MT internally)</label>
      <input
        list={unitListId}
        placeholder="Unit, e.g. MT, BAG, MAUND"
        value={value.unit}
        onChange={(e) => {
          const v = e.target.value;
          onChange({
            ...value,
            unit: v,
            canonicalKgPerUnit: defaultKgPerUnit(v) || value.canonicalKgPerUnit,
          });
        }}
        className="w-full rounded-md border border-kastros-border bg-kastros-bg px-2 py-1.5 text-sm text-foreground"
      />
      <label className="mt-1 text-xs text-subtle">kg per 1 {value.unit || "unit"}</label>
      <input
        type="number"
        step="0.0001"
        title="Conversion to kg — all units convert unit → kg → MT"
        value={value.canonicalKgPerUnit}
        onChange={(e) => onChange({ ...value, canonicalKgPerUnit: Number(e.target.value) })}
        className="w-full rounded-md border border-kastros-border bg-kastros-bg px-2 py-1.5 text-sm text-foreground data-grid"
      />
      <datalist id={unitListId}>
        {quantityUnitOptions.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>

      <div className="rounded-md border border-kastros-border/60 bg-kastros-bg/30 p-2">
        <div className="text-xs font-medium text-muted-foreground">Local price metric</div>
        <div className="mt-1 grid grid-cols-3 gap-1.5">
          <select
            value={value.localCurrency}
            onChange={(e) => onChange({ ...value, localCurrency: e.target.value as PriceCurrency })}
            className="kastros-select kastros-select-sm"
          >
            {PRICE_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {PRICE_CURRENCY_LABELS[c]}
              </option>
            ))}
          </select>
          <input
            list={unitListId}
            placeholder="per maund"
            value={value.localWeightUnit}
            onChange={(e) => {
              const v = e.target.value;
              onChange({
                ...value,
                localWeightUnit: v,
                localKgPerUnit: defaultKgPerUnit(v) || value.localKgPerUnit,
              });
            }}
            className="kastros-select kastros-select-sm"
          />
          <input
            type="number"
            step="0.0001"
            title="kg per unit"
            value={value.localKgPerUnit}
            onChange={(e) => onChange({ ...value, localKgPerUnit: Number(e.target.value) })}
            className="rounded-md border border-kastros-border bg-kastros-bg px-2 py-1.5 text-xs text-foreground data-grid"
          />
        </div>
      </div>

      <div className="rounded-md border border-kastros-border/60 bg-kastros-bg/30 p-2">
        <div className="text-xs font-medium text-muted-foreground">International price metric</div>
        <div className="mt-1 grid grid-cols-3 gap-1.5">
          <select
            value={value.intlCurrency}
            onChange={(e) => onChange({ ...value, intlCurrency: e.target.value as PriceCurrency })}
            className="kastros-select kastros-select-sm"
          >
            {PRICE_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {PRICE_CURRENCY_LABELS[c]}
              </option>
            ))}
          </select>
          <input
            list={unitListId}
            placeholder="per lb"
            value={value.intlWeightUnit}
            onChange={(e) => {
              const v = e.target.value;
              onChange({
                ...value,
                intlWeightUnit: v,
                intlKgPerUnit: defaultKgPerUnit(v) || value.intlKgPerUnit,
              });
            }}
            className="kastros-select kastros-select-sm"
          />
          <input
            type="number"
            step="0.0001"
            title="kg per unit"
            value={value.intlKgPerUnit}
            onChange={(e) => onChange({ ...value, intlKgPerUnit: Number(e.target.value) })}
            className="rounded-md border border-kastros-border bg-kastros-bg px-2 py-1.5 text-xs text-foreground data-grid"
          />
        </div>
      </div>

      <p className="text-xs text-subtle">
        Prices auto-convert to MT internally. Optional quality / logistics fields persist on this commodity.
      </p>
      <TradeParametersFields
        definitions={tradeParameterDefs}
        values={{}}
        onChange={() => {}}
        showAddCustom
        onAddCustomParam={(def) => onTradeParameterDefsChange([...tradeParameterDefs, def])}
        emptyMessage="No extra fields — add templates that appear whenever this commodity is booked."
      />
    </div>
  );
}
