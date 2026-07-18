"use client";

import { trpc } from "@/lib/trpc/client";
import { formatCurrency, formatPct, formatQty } from "@/lib/formatters/numbers";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const typeLabel: Record<string, string> = {
  WAREHOUSE: "Warehouse",
  SILO: "Silo",
  PORT: "Port",
  FARM: "Farm",
};

export default function LocationsPage() {
  const { data: locations, isLoading } = trpc.supplyChain.locations.useQuery();

  if (isLoading || !locations) {
    return <div className="animate-pulse text-subtle">Loading warehouse network…</div>;
  }

  const chartData = locations.map((l) => ({
    name: l.name.replace(" Warehouse", "").replace(" Port", "").replace(" Silo Cluster", ""),
    onHand: l.onHand,
    available: l.availableCapacity,
    utilization: Math.round(l.utilization * 100),
  }));

  const totalCapacity = locations.reduce((a, l) => a + l.capacityMt, 0);
  const totalOnHand = locations.reduce((a, l) => a + l.onHand, 0);
  const totalValue = locations.reduce((a, l) => a + l.value, 0);

  return (
    <div className="kastros-desk-page">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Warehouse & Port Network</h1>
        <p className="text-sm text-subtle">
          Storage capacity, utilization, and commodity mix across the physical network.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "Locations", value: locations.length.toString() },
          { label: "Total capacity", value: `${formatQty(totalCapacity)} MT` },
          { label: "Stock on hand", value: `${formatQty(totalOnHand)} MT` },
          { label: "Network value", value: formatCurrency(totalValue) },
        ].map((t) => (
          <div key={t.label} className="rounded-lg border border-kastros-border bg-kastros-card px-3 py-2.5">
            <div className="text-xs uppercase tracking-wide text-subtle">{t.label}</div>
            <div className="mt-1 text-lg font-medium text-foreground">{t.value}</div>
          </div>
        ))}
      </div>

      <div className="h-56 rounded-lg border border-kastros-border bg-kastros-card p-3">
        <div className="text-sm text-muted-foreground">Capacity utilization by site</div>
        <ResponsiveContainer width="100%" height="90%">
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a3142" />
            <XAxis dataKey="name" stroke="#9ca3af" />
            <YAxis stroke="#9ca3af" unit="%" domain={[0, 100]} />
            <Tooltip contentStyle={{ background: "#1a1f2e", border: "1px solid #2a3142" }} />
            <Bar dataKey="utilization" name="Utilization %" radius={[4, 4, 0, 0]}>
              {chartData.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={entry.utilization > 80 ? "#ff4d4f" : entry.utilization > 60 ? "#f59e0b" : "#00C896"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {locations.map((loc) => (
          <div key={loc.id} className="rounded-lg border border-kastros-border bg-kastros-card p-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-medium text-foreground">{loc.name}</h2>
                <div className="mt-0.5 text-xs text-subtle">
                  {typeLabel[loc.type] ?? loc.type} · {loc.region}, {loc.country}
                </div>
              </div>
              <span
                className={`rounded px-2 py-0.5 text-xs ${
                  loc.utilization > 0.8
                    ? "bg-red-500/20 text-red-400"
                    : loc.utilization > 0.6
                      ? "bg-warning/20 text-warning"
                      : "bg-success/20 text-success"
                }`}
              >
                {formatPct(loc.utilization)} full
              </span>
            </div>

            <div className="mt-3 h-2 overflow-hidden rounded-full bg-kastros-bg">
              <div
                className={`h-full rounded-full ${
                  loc.utilization > 0.8 ? "bg-red-500" : loc.utilization > 0.6 ? "bg-warning" : "bg-brand"
                }`}
                style={{ width: `${Math.min(100, loc.utilization * 100)}%` }}
              />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div className="text-subtle">Capacity</div>
              <div className="data-grid text-right text-muted-foreground">{formatQty(loc.capacityMt)} MT</div>
              <div className="text-subtle">On hand</div>
              <div className="data-grid text-right text-muted-foreground">{formatQty(loc.onHand)} MT</div>
              <div className="text-subtle">Reserved</div>
              <div className="data-grid text-right text-muted-foreground">{formatQty(loc.reserved)} MT</div>
              <div className="text-subtle">In transit (inbound)</div>
              <div className="data-grid text-right text-muted-foreground">{formatQty(loc.inTransit)} MT</div>
              <div className="text-subtle">Available capacity</div>
              <div className="data-grid text-right text-success">{formatQty(loc.availableCapacity)} MT</div>
              <div className="text-subtle">Inventory value</div>
              <div className="data-grid text-right text-muted-foreground">{formatCurrency(loc.value)}</div>
              <div className="text-subtle">Active lots</div>
              <div className="text-right text-muted-foreground">{loc.lotCount}</div>
              <div className="text-subtle">Active shipments</div>
              <div className="text-right text-muted-foreground">{loc.activeShipments}</div>
            </div>

            {loc.commodities.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {loc.commodities.map((c) => (
                  <span key={c} className="rounded bg-kastros-border px-2 py-0.5 text-xs text-muted-foreground">
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
