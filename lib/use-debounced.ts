"use client";

import { useEffect, useState } from "react";

/**
 * The value as it stands once it has stopped changing for `delayMs`.
 *
 * For inputs that trigger a lookup: typing an eight-character invoice number
 * would otherwise fire eight queries, seven of them for prefixes nobody asked
 * about.
 */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
