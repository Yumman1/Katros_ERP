"use client";

import { UNIVERSAL_TRADE_FIELDS, type TradeParamValues } from "@/lib/trade-parameters";
import { ParamField } from "@/components/trader/param-field";
/** Universal contract fields — rendered exactly once per trade. */
export function ContractDetailsFields({
  values,
  onChange,
}: {
  values: TradeParamValues;
  onChange: (key: string, value: string) => void;
}) {
  const main = UNIVERSAL_TRADE_FIELDS.filter(
    (d) => d.key !== "otherTerms" && d.key !== "contactPerson",
  );
  const otherTerms = UNIVERSAL_TRADE_FIELDS.find((d) => d.key === "otherTerms");

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {main.map((def) => (
        <ParamField key={def.key} def={def} value={values[def.key]} onChange={onChange} />
      ))}
      {otherTerms && (
        <div className="sm:col-span-2">
          <ParamField def={otherTerms} value={values[otherTerms.key]} onChange={onChange} />
        </div>
      )}
    </div>
  );
}
