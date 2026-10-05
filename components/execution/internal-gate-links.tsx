"use client";
import { trpc } from "@/lib/trpc/client";

export function InternalGateLinks() {
  const { data, error } = trpc.execution.internalGateLink.useQuery();
  return <div className="kastros-card p-4 flex flex-wrap gap-3 items-center">
    <span className="text-sm font-medium">Internal warehouse gate register</span>
    {data ? <>{(["out", "in"] as const).map(direction => <a key={direction} className="kastros-btn-secondary" href={`${data.href}&direction=${direction}`} target="_blank" rel="noopener noreferrer">Internal truck {direction}</a>)}<span className="text-xs text-subtle">Open and share with warehouse staff. Links are valid for 30 days.</span></> : <span className="text-sm">{error?.message ?? "Loading gate links…"}</span>}
  </div>;
}
