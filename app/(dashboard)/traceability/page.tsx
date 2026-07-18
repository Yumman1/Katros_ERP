"use client";

import { trpc } from "@/lib/trpc/client";
import { formatQty } from "@/lib/formatters/numbers";
import Link from "next/link";
import { useState } from "react";

export default function TraceabilityPage() {
  const [q, setQ] = useState("");
  const { data } = trpc.traceability.search.useQuery({ q: q || undefined });

  return (
    <div className="kastros-desk-page">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Traceability</h1>
        <p className="text-sm text-subtle">Farm-to-delivery chain of custody.</p>
      </div>
      <input
        placeholder="Search batch ref…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full max-w-md rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-foreground"
      />
      <div className="grid gap-2">
        {data?.map((b) => (
          <Link
            key={b.id}
            href={`/traceability/${b.id}`}
            className="flex items-center justify-between rounded-lg border border-kastros-border bg-kastros-card px-4 py-3 text-sm hover:border-success/40"
          >
            <div>
              <div className="font-medium text-foreground">{b.batchRef}</div>
              <div className="text-xs text-subtle">
                {b.commodity.code} · {b.farmLocation}
              </div>
            </div>
            <div className="data-grid text-muted-foreground">{formatQty(Number(b.quantity))} MT</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
