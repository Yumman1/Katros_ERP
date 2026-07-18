"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export type GatepassCommodity = {
  code: string;
  name: string;
};

export type GatepassCounterparty = {
  name: string;
  code: string;
  openTradeCount: number;
  commodities: GatepassCommodity[];
};

export const gatepassInputClass = "kastros-input w-full rounded-xl py-2.5";
const selectTriggerClass = `${gatepassInputClass} flex w-full items-center justify-between gap-2 bg-input text-left disabled:cursor-not-allowed disabled:opacity-60`;
const dropdownPanelClass =
  "absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-border bg-card py-1 text-card-foreground shadow-lg ring-1 ring-border";
const dropdownItemClass =
  "w-full px-3 py-2.5 text-left transition-colors hover:bg-brand-muted focus-visible:bg-brand-muted focus-visible:outline-none";

export function GatepassModeButton({
  active,
  onClick,
  icon,
  label,
  color,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  color: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all"
      style={{ background: active ? `${color}20` : "transparent", color: active ? color : "#71717a" }}
    >
      {icon}
      {label}
    </button>
  );
}

export function GatepassFormSection({
  title,
  icon,
  children,
  color,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  color: string;
}) {
  return (
    <section className="rounded-2xl border border-border bg-foreground/[0.02] p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <span style={{ color }}>{icon}</span>
        {title}
      </div>
      {children}
    </section>
  );
}

export function GatepassField({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        {label}
        {required && <span className="text-red-400">*</span>}
        {hint && <span className="text-subtle">({hint})</span>}
      </label>
      {children}
    </div>
  );
}

export function GatepassCounterpartySelect({
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (name: string) => void;
  options: GatepassCounterparty[];
  placeholder: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.name === value);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={selectTriggerClass}
      >
        <span className={`min-w-0 truncate ${selected ? "text-foreground font-medium" : "text-muted-foreground"}`}>
          {selected ? `${selected.name} (${selected.code})` : placeholder}
        </span>
        <ChevronDown
          className={`h-4 w-4 flex-shrink-0 text-subtle transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && options.length > 0 && (
        <ul className={dropdownPanelClass} role="listbox">
          {options.map((cp) => (
            <li key={cp.name} role="option" aria-selected={cp.name === value}>
              <button
                type="button"
                className={`${dropdownItemClass} ${cp.name === value ? "bg-brand-muted" : ""}`}
                onClick={() => {
                  onChange(cp.name);
                  setOpen(false);
                }}
              >
                <div className="text-sm font-medium text-foreground">{cp.name}</div>
                <div className="text-xs text-muted-foreground">
                  {cp.code} · {cp.openTradeCount} open trade{cp.openTradeCount !== 1 ? "s" : ""}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function GatepassCommoditySelect({
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (code: string) => void;
  options: GatepassCommodity[];
  placeholder: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.code === value);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={selectTriggerClass}
      >
        <span className={`min-w-0 truncate ${selected ? "text-foreground font-medium" : "text-muted-foreground"}`}>
          {selected ? `${selected.name} (${selected.code})` : placeholder}
        </span>
        <ChevronDown
          className={`h-4 w-4 flex-shrink-0 text-subtle transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && options.length > 0 && (
        <ul className={dropdownPanelClass} role="listbox">
          {options.map((c) => (
            <li key={c.code} role="option" aria-selected={c.code === value}>
              <button
                type="button"
                className={`${dropdownItemClass} text-sm text-foreground ${
                  c.code === value ? "bg-brand-muted" : ""
                }`}
                onClick={() => {
                  onChange(c.code);
                  setOpen(false);
                }}
              >
                {c.name} <span className="text-subtle">({c.code})</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
