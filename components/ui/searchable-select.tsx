"use client";

import { Children, Fragment, cloneElement, forwardRef, isValidElement, useCallback, useRef, useState, type ReactNode, type SelectHTMLAttributes } from "react";

type Props = SelectHTMLAttributes<HTMLSelectElement> & { searchable?: boolean };

function textOf(node: ReactNode): string {
  return Children.toArray(node).map((child) => isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : String(child)).join("");
}

function optionsOf(node: ReactNode): ReactNode[] {
  return Children.toArray(node).flatMap((child) => isValidElement<{ children?: ReactNode }>(child) && (child.type === Fragment || child.type === "optgroup") ? optionsOf(child.props.children) : [child]);
}

/** Keeps the native select, its value, form registration and change event intact. */
export const SearchableSelect = forwardRef<HTMLSelectElement, Props>(function SearchableSelect(
  { children, searchable, onChange, className, ...props }, forwardedRef,
) {
  const [query, setQuery] = useState("");
  const selectRef = useRef<HTMLSelectElement | null>(null);
  const options = optionsOf(children);
  const enabled = !props.multiple && (searchable ?? options.length > 6);
  const needle = query.trim().toLocaleLowerCase();
  const matchesOption = (child: ReactNode): boolean => {
    if (!isValidElement<{ children?: ReactNode; value?: string }>(child)) return true;
    const label = textOf(child.props.children).trim();
    // Master-data selectors often display "CODE — Name"; search the name too.
    const name = label.includes(" — ") ? label.split(" — ").slice(1).join(" — ") : label;
    return !needle || child.props.value === "" || child.props.value === "__add_new__" || name.toLocaleLowerCase().startsWith(needle) || label.toLocaleLowerCase().startsWith(needle);
  };
  const matches = options.filter(matchesOption);
  // Keep every option mounted so searching never changes a registered form's value.
  const filteredChildren = (nodes: ReactNode): ReactNode => Children.map(nodes, (child) => {
    if (!isValidElement<{ children?: ReactNode; hidden?: boolean }>(child)) return child;
    if (child.type === Fragment || child.type === "optgroup") {
      return cloneElement(child, {}, filteredChildren(child.props.children));
    }
    return cloneElement(child, { hidden: child.props.hidden || (enabled && !!needle && !matchesOption(child)) });
  });
  const setRef = useCallback((node: HTMLSelectElement | null) => {
    selectRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);
  const select = <select {...props} ref={setRef} className={className} size={enabled && needle ? Math.min(6, Math.max(2, matches.length)) : props.size}
    onChange={(event) => { onChange?.(event); setQuery(""); }}
    onKeyDown={(event) => { if (event.key === "Escape") setQuery(""); props.onKeyDown?.(event); }}>
    {filteredChildren(children)}
  </select>;
  const hasMatches = matches.some((child) => isValidElement<{ value?: string }>(child) && child.props.value !== "" && child.props.value !== "__add_new__");
  return <span className={`inline-flex min-w-0 max-w-full flex-col gap-1 align-bottom ${className?.includes("w-full") ? "w-full" : ""} ${className?.includes("flex-1") ? "flex-1" : ""}`}>
    {enabled && <input type="search" aria-label={`Search ${props["aria-label"] ?? props.name ?? "options"}`} placeholder="Type first letters…" autoComplete="off"
      className="kastros-input w-full min-w-0 text-xs" disabled={props.disabled} value={query}
      onChange={(event) => setQuery(event.target.value)}
      onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); selectRef.current?.focus(); } if (event.key === "Escape") setQuery(""); if (event.key === "Enter") event.preventDefault(); }} />}
    {select}
    {enabled && needle && !hasMatches && <span role="status" className="text-xs text-subtle">No matching options</span>}
  </span>;
});
