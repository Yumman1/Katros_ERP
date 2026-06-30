"use client";

import type { CommodityOption } from "@/lib/execution-commodity-filter";

type Props = {
  commodities: CommodityOption[];
  value: string;
  onChange: (code: string) => void;
};

export function CommodityFilterBar({ commodities, value, onChange }: Props) {
  if (commodities.length === 0) return null;

  return (
    <section
      className="rounded-2xl p-3"
      style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}
    >
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Filter by commodity
      </div>
      <div className="flex flex-wrap gap-2">
        <FilterChip active={value === "ALL"} onClick={() => onChange("ALL")} label="All commodities" />
        {commodities.map((c) => (
          <FilterChip
            key={c.code}
            active={value === c.code}
            onClick={() => onChange(c.code)}
            label={`${c.name} (${c.code})`}
          />
        ))}
      </div>
    </section>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
      style={{
        background: active ? "rgba(245,158,11,0.18)" : "rgba(255,255,255,0.04)",
        border: `1px solid ${active ? "rgba(245,158,11,0.45)" : "rgba(255,255,255,0.08)"}`,
        color: active ? "#fbbf24" : "#a1a1aa",
      }}
    >
      {label}
    </button>
  );
}
