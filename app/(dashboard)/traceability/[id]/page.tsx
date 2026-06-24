"use client";

import { trpc } from "@/lib/trpc/client";
import { formatQty } from "@/lib/formatters/numbers";
import Link from "next/link";
import { useParams } from "next/navigation";

export default function TraceabilityDetailPage() {
  const params = useParams<{ id: string }>();
  const { data, isLoading } = trpc.traceability.byId.useQuery({ id: params.id });

  if (isLoading || !data) {
    return <div className="text-zinc-500">Loading batch…</div>;
  }

  return (
    <div className="space-y-6">
      <Link href="/traceability" className="text-sm text-kastros-green hover:underline">
        ← Back to batches
      </Link>
      <div>
        <h1 className="text-2xl font-semibold text-white">{data.batchRef}</h1>
        <p className="text-sm text-zinc-500">
          {data.commodity.name} · {formatQty(Number(data.quantity))} MT · Harvest{" "}
          {data.harvestDate.toISOString().slice(0, 10)}
        </p>
        {data.certifications?.length ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {data.certifications.map((c) => (
              <span
                key={c}
                className="rounded bg-kastros-green/15 px-2 py-0.5 text-xs text-kastros-green"
              >
                {c}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-kastros-border bg-kastros-card p-4">
        <h2 className="text-sm font-medium text-zinc-300">Chain of custody</h2>
        <ol className="relative mt-4 space-y-6 border-l border-kastros-border pl-6">
          {data.chainOfCustody.map((ev) => (
            <li key={ev.id} className="relative">
              <span className="absolute -left-[29px] top-1 h-3 w-3 rounded-full bg-kastros-green" />
              <div className="text-sm font-medium text-white">{ev.eventType}</div>
              <div className="text-xs text-zinc-500">
                {ev.eventDate.toISOString().slice(0, 10)} · {ev.location} · {ev.actor}
              </div>
              {ev.notes && <p className="mt-1 text-sm text-zinc-400">{ev.notes}</p>}
            </li>
          ))}
        </ol>
      </div>

      {data.tradeLinks.length > 0 && (
        <div className="rounded-lg border border-kastros-border bg-kastros-card p-4 text-sm">
          <h2 className="font-medium text-zinc-300">Linked trades</h2>
          <ul className="mt-2 space-y-1 text-zinc-400">
            {data.tradeLinks.map((l) => (
              <li key={l.id}>{l.trade.tradeRef}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
