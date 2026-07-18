"use client";

import { cn } from "@/lib/utils";
import { Download } from "lucide-react";

type Props = {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onExport: () => void;
  count?: number;
  disabled?: boolean;
  label?: string;
  className?: string;
};

export function ExcelExportBar({
  from,
  to,
  onFromChange,
  onToChange,
  onExport,
  count,
  disabled,
  label = "Download Excel",
  className,
}: Props) {
  return (
    <div className={cn("flex flex-wrap items-end gap-2", className)}>
      <label className="space-y-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-subtle">From</span>
        <input
          type="date"
          value={from}
          onChange={(e) => onFromChange(e.target.value)}
          className="kastros-input kastros-input-sm block"
          aria-label="Export from date"
        />
      </label>
      <label className="space-y-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-subtle">To</span>
        <input
          type="date"
          value={to}
          onChange={(e) => onToChange(e.target.value)}
          className="kastros-input kastros-input-sm block"
          aria-label="Export to date"
        />
      </label>
      <button
        type="button"
        onClick={onExport}
        disabled={disabled}
        className="kastros-btn-primary inline-flex items-center gap-1.5 px-3 py-2 text-xs disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5" />
        {label}
        {count != null ? ` (${count})` : ""}
      </button>
    </div>
  );
}
