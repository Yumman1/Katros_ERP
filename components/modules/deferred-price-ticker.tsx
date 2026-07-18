"use client";

import dynamic from "next/dynamic";

/** Defer SSE price ticker until after first paint — not needed for shell chrome. */
export const DeferredPriceTicker = dynamic(
  () => import("@/components/modules/price-ticker").then((m) => m.PriceTicker),
  { ssr: false, loading: () => <span className="text-xs text-subtle">…</span> },
);
