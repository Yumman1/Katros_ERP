"use client";

import { trpc } from "@/lib/trpc/client";
import { formatCurrency } from "@/lib/formatters/numbers";
import { getHomeForRole } from "@/lib/routing";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function DashboardPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const { data: kpis, isLoading } = trpc.reports.kpis.useQuery();

  useEffect(() => {
    if (session?.user?.role === "TRADER") {
      router.replace(getHomeForRole("TRADER"));
    }
  }, [session, router]);

  if (session?.user?.role === "TRADER") {
    return <div className="animate-pulse text-zinc-500">Opening trading desk…</div>;
  }

  if (isLoading || !kpis) {
    return <div className="animate-pulse text-zinc-500">Loading desk snapshot…</div>;
  }

  const tiles = [
    { label: "Trades YTD", value: kpis.tradesYtd.toLocaleString() },
    { label: "Open trades", value: kpis.openTrades.toLocaleString() },
    { label: "Inventory value", value: formatCurrency(kpis.inventoryValue) },
    { label: "Open MTM P&L", value: formatCurrency(kpis.openMtmPnl) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Trading desk overview</h1>
        <p className="text-sm text-zinc-500">
          Real-time risk snapshot — grains, oilseeds, softs, vegoils.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="rounded-lg border border-kastros-border bg-kastros-card px-4 py-3"
          >
            <div className="text-xs uppercase tracking-wide text-zinc-500">{t.label}</div>
            <div className="mt-1 data-grid text-lg font-medium text-white">{t.value}</div>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-kastros-border bg-kastros-card p-4">
        <h2 className="text-sm font-medium text-zinc-300">Quick links</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href="/positions"
            className="rounded-md border border-kastros-border px-3 py-1.5 text-sm text-kastros-green hover:bg-white/5"
          >
            Positions
          </Link>
          <Link
            href="/mtm"
            className="rounded-md border border-kastros-border px-3 py-1.5 text-sm text-kastros-green hover:bg-white/5"
          >
            MTM
          </Link>
          <Link
            href="/cashflow"
            className="rounded-md border border-kastros-border px-3 py-1.5 text-sm text-kastros-green hover:bg-white/5"
          >
            Cash flow
          </Link>
          <Link
            href="/supply-chain"
            className="rounded-md border border-kastros-border px-3 py-1.5 text-sm text-kastros-green hover:bg-white/5"
          >
            Supply chain
          </Link>
          <Link
            href="/traceability"
            className="rounded-md border border-kastros-border px-3 py-1.5 text-sm text-kastros-green hover:bg-white/5"
          >
            Traceability
          </Link>
        </div>
      </div>
    </div>
  );
}
