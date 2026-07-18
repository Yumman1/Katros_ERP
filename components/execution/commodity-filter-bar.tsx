"use client";

import type { CommodityOption } from "@/lib/execution-commodity-filter";
import { cn } from "@/lib/utils";

type Props = {
  commodities: CommodityOption[];
  value: string;
  onChange: (code: string) => void;
  compact?: boolean;
};

export function CommodityFilterBar({ commodities, value, onChange, compact }: Props) {
  if (commodities.length === 0) return null;

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wide text-subtle">Commodity</span>
        <FilterChip active={value === "ALL"} onClick={() => onChange("ALL")} label="All" compact />
        {commodities.map((c) => (
          <FilterChip
            key={c.code}
            active={value === c.code}
            onClick={() => onChange(c.code)}
            label={c.code}
            compact
            title={`${c.name} (${c.code})`}
          />
        ))}
      </div>
    );
  }

  return (
    <section className="exec-panel">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-subtle">
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
  compact,
  title,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  compact?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "rounded-full border font-medium transition-colors",
        compact ? "px-2 py-0.5 text-[10px]" : "px-3 py-1.5 text-xs",
        active
          ? "border-accent bg-accent-muted font-semibold text-foreground"
          : "border-border bg-card text-muted-foreground hover:border-brand/40 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
