"use client";

import { useState } from "react";

export type CreatableOption = { value: string; label: string };

const ADD_NEW = "__add_new__";

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: CreatableOption[];
  onAdd: (label: string) => Promise<CreatableOption>;
  placeholder?: string;
  addLabel?: string;
  disabled?: boolean;
  className?: string;
};

export function CreatableSelect({
  value,
  onChange,
  options,
  onAdd,
  placeholder = "Select…",
  addLabel = "+ Add new…",
  disabled,
  className,
}: Props) {
  const [mode, setMode] = useState<"select" | "add">("select");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const selectClass =
    className ??
    "w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-white";

  if (mode === "add") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Enter name…"
            disabled={disabled || busy}
            className="min-w-0 flex-1 rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-white"
          />
          <button
            type="button"
            disabled={disabled || busy || !draft.trim()}
            onClick={async () => {
              setAddError(null);
              setBusy(true);
              try {
                const row = await onAdd(draft.trim());
                onChange(row.value);
                setDraft("");
                setMode("select");
              } catch (e) {
                setAddError(e instanceof Error ? e.message : "Could not add");
              } finally {
                setBusy(false);
              }
            }}
            className="shrink-0 rounded-md bg-kastros-green px-3 py-2 text-xs font-semibold text-kastros-bg disabled:opacity-50"
          >
            {busy ? "…" : "Add"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setMode("select");
              setDraft("");
              setAddError(null);
            }}
            className="shrink-0 rounded-md border border-kastros-border px-3 py-2 text-xs text-zinc-400"
          >
            Cancel
          </button>
        </div>
        {addError && <p className="text-xs text-kastros-red">{addError}</p>}
      </div>
    );
  }

  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => {
        if (e.target.value === ADD_NEW) {
          setMode("add");
          return;
        }
        onChange(e.target.value);
      }}
      className={selectClass}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      <option value={ADD_NEW}>{addLabel}</option>
    </select>
  );
}
