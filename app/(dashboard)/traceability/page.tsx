"use client";

import { trpc } from "@/lib/trpc/client";
import { formatQty } from "@/lib/formatters/numbers";
import Link from "next/link";
import { useState } from "react";

export default function TraceabilityPage() {
  const [q, setQ] = useState("");
  const { data } = trpc.traceability.search.useQuery({ q: q || undefined });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-white">Traceability</h1>
        <p className="text-sm text-zinc-500">Farm-to-delivery chain of custody.</p>
      </div>
      <input
        placeholder="Search batch ref…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full max-w-md rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-white"
      />
      <div className="grid gap-2">
        {data?.map((b) => (
          <Link
            key={b.id}
            href={`/traceability/${b.id}`}
            className="flex items-center justify-between rounded-lg border border-kastros-border bg-kastros-card px-4 py-3 text-sm hover:border-kastros-green/40"
          >
            <div>
              <div className="font-medium text-white">{b.batchRef}</div>
              <div className="text-xs text-zinc-500">
                {b.commodity.code} · {b.farmLocation}
              </div>
            </div>
            <div className="data-grid text-zinc-400">{formatQty(Number(b.quantity))} MT</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
