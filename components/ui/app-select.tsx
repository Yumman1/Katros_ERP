"use client";

import {useEffect, useId, useRef, useState} from "react";

type Option = {value: string; label: string};
type Props = {
  id?: string;
  label: string;
  value: string;
  options: Option[];
  placeholder: string;
  disabled?: boolean;
  allowEmpty?: boolean;
  className?: string;
  onValueChange: (value: string) => void;
};

/** App-rendered options avoid platform-native select popup colour/rendering bugs. */
export function AppSelect({id, label, value, options, placeholder, disabled, allowEmpty = true, className, onValueChange}: Props) {
  const generatedId = useId();
  const listId = `${generatedId}-options`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const selected = options.find(option => option.value === value);
  const filtered = options.filter(option => option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const shown = allowEmpty ? [{value: "", label: placeholder}, ...filtered] : filtered;
  const activeIndex = Math.min(active, shown.length - 1);
  const expanded = open && !disabled;

  useEffect(() => { if (expanded) search.current?.focus(); }, [expanded]);
  useEffect(() => {
    if (expanded) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({block: "nearest"});
  }, [expanded, activeIndex, listId]);

  function close() { setOpen(false); setQuery(""); setActive(0); }
  function choose(next: string) { onValueChange(next); close(); trigger.current?.focus(); }

  return <span className={`inline-flex min-w-0 flex-col ${className ?? "w-full"}`}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close(); }}>
    <button id={id} ref={trigger} type="button" disabled={disabled} aria-label={label}
      aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded ? listId : undefined}
      className="kastros-select flex w-full items-center justify-between gap-2 text-left disabled:opacity-50"
      onClick={() => { if (expanded) close(); else {setOpen(true); setActive(0);} }}
      onKeyDown={event => {if (event.key === "ArrowDown" || event.key === "ArrowUp") {event.preventDefault(); setOpen(true);}}}>
      <span className="truncate">{selected?.label ?? (value || placeholder)}</span><span aria-hidden="true">▾</span>
    </button>
    {expanded && <span className="mt-1 block rounded-lg border border-border bg-card p-2 text-foreground shadow-lg">
      <input ref={search} role="combobox" aria-label={`Search ${label}`} aria-expanded="true"
        aria-controls={listId} aria-autocomplete="list" aria-activedescendant={shown.length ? `${listId}-${activeIndex}` : undefined}
        value={query} placeholder="Search options…" className="kastros-input mb-2 w-full" autoComplete="off"
        onChange={event => {setQuery(event.target.value); setActive(0);}}
        onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {event.preventDefault(); setActive(index => Math.max(0, Math.min(shown.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));}
          if (event.key === "Enter") {event.preventDefault(); if(shown[activeIndex]) choose(shown[activeIndex].value);}
          if (event.key === "Escape") {event.preventDefault(); close(); trigger.current?.focus();}
        }}/>
      <span id={listId} role="listbox" aria-label={label} className="block max-h-60 overflow-y-auto">
        {shown.map((option,index) => <span key={option.value} id={`${listId}-${index}`} role="option"
          aria-selected={value === option.value}
          className={`block cursor-pointer rounded-md px-3 py-2 text-sm ${index === activeIndex ? "bg-accent text-accent-foreground" : "bg-card text-foreground"}`}
          onMouseDown={event => event.preventDefault()} onMouseMove={() => setActive(index)}
          onClick={event => {event.preventDefault(); choose(option.value);}}>
          {option.label}{value === option.value ? " ✓" : ""}
        </span>)}
      </span>
      {!filtered.length && <span role="status" className="block p-2 text-sm text-muted-foreground">{options.length ? "No matching options" : "No available options"}</span>}
    </span>}
  </span>;
}
