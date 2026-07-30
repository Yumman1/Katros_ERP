"use client";

import { trpc } from "@/lib/trpc/client";
import { formatQtyWithUnit } from "@/lib/formatters/numbers";
import { summarizeQtyByUnit } from "@/lib/formatters/execution-units";
import {
  buildLocationCommodityInventory,
} from "@/lib/inventory-stock";
import {
  aggregateWarehouseStock,
  warehouseUtilizationSummary,
} from "@/lib/warehouse-utilization";
import { DESK_REFETCH_MS } from "@/lib/invalidate-caches";
import { ArrowUpFromLine, Banknote, Boxes, Package, Truck, Warehouse } from "lucide-react";
import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ListPagination } from "@/components/ui/list-pagination";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";
import { useListPagination } from "@/lib/use-list-pagination";

export default function ExecutionInventoryPage() {
  const { data: contracts, isLoading: loadingContracts } = trpc.execution.lockedContracts.useQuery({
    warehouseAllocated: true,
  });
  const { data: warehouseLocations } = trpc.execution.warehouseLocations.useQuery();
  const { data: inbound, isLoading: loadingInbound } = trpc.execution.inboundReceipts.useQuery({});
  const { data: outbound, isLoading: loadingOutbound } = trpc.execution.outboundDispatches.useQuery({});
  const { data: pendingTrucks } = trpc.execution.pendingTrucks.useQuery(
    {},
    { refetchInterval: DESK_REFETCH_MS },
  );
  const { data: valuation } = trpc.execution.inventoryValuation.useQuery(undefined, {
    refetchInterval: DESK_REFETCH_MS,
  });
  const { data: stockTransfers } = trpc.execution.stockTransfers.useQuery({});

  const contractByRef = useMemo(
    () => new Map((contracts ?? []).map((c) => [c.tradeRef, c])),
    [contracts],
  );

  const warehouseConfigByName = useMemo(
    () => new Map((warehouseLocations ?? []).map((w) => [w.name, w])),
    [warehouseLocations],
  );

  const commodityForTradeRef = useMemo(
    () => (tradeRef: string) => {
      const c = contractByRef.get(tradeRef);
      if (!c) return null;
      return { code: c.commodityCode, name: c.commodityName, unit: c.quantityUnit };
    },
    [contractByRef],
  );

  const locationCommodityRows = useMemo(
    () =>
      buildLocationCommodityInventory({
        inbound: inbound ?? [],
        outbound: outbound ?? [],
        pendingTrucks: pendingTrucks ?? [],
        transfers: stockTransfers ?? [],
        commodityForTradeRef,
      }),
    [inbound, outbound, pendingTrucks, stockTransfers, commodityForTradeRef],
  );

  const warehouses = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        netMt: number;
        unallocatedMt: number;
        allocatedMt: number;
        commodities: Map<string, { code: string; unit: string; qty: number; unallocated: number; allocated: number }>;
      }
    >();

    for (const row of locationCommodityRows) {
      const wh =
        map.get(row.warehouseName) ??
        {
          name: row.warehouseName,
          netMt: 0,
          unallocatedMt: 0,
          allocatedMt: 0,
          commodities: new Map(),
        };
      wh.netMt += row.netQty;
      wh.unallocatedMt += row.unallocatedQty;
      wh.allocatedMt += row.allocatedQty;
      const key = `${row.commodityCode}|${row.quantityUnit}`;
      wh.commodities.set(key, {
        code: row.commodityCode,
        unit: row.quantityUnit,
        qty: row.netQty,
        unallocated: row.unallocatedQty,
        allocated: row.allocatedQty,
      });
      map.set(row.warehouseName, wh);
    }

    return Array.from(map.values()).sort((a, b) => b.netMt - a.netMt);
  }, [locationCommodityRows]);

  const warehousePagination = useListPagination(warehouses);
  const locationPagination = useListPagination(locationCommodityRows);

  const totalStockLabel = useMemo(() => {
    const items: { qty: number; unit: string }[] = locationCommodityRows
      .filter((r) => Math.abs(r.netQty) > 0.001)
      .map((r) => ({ qty: r.netQty, unit: r.quantityUnit }));
    return summarizeQtyByUnit(items, 2);
  }, [locationCommodityRows]);

  const totalUnallocatedLabel = useMemo(() => {
    const items = locationCommodityRows
      .filter((r) => Math.abs(r.unallocatedQty) > 0.001)
      .map((r) => ({ qty: r.unallocatedQty, unit: r.quantityUnit }));
    return summarizeQtyByUnit(items, 2);
  }, [locationCommodityRows]);

  const totalAllocatedLabel = useMemo(() => {
    const items = locationCommodityRows
      .filter((r) => Math.abs(r.allocatedQty) > 0.001)
      .map((r) => ({ qty: r.allocatedQty, unit: r.quantityUnit }));
    return summarizeQtyByUnit(items, 2);
  }, [locationCommodityRows]);

  const loading = loadingContracts || loadingInbound || loadingOutbound;

  if (loading && !contracts && !inbound && !outbound) {
    return (
      <div className="kastros-desk-page">
        <PageLoadingSkeleton label="Loading inventory…" rows={8} />
      </div>
    );
  }

  return (
    <div className="kastros-desk-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Link href="/execution" className="hover:text-foreground">
              Desk
            </Link>
            <span>/</span>
            <span className="text-foreground">Inventory</span>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-foreground">Inventory Statistics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Unallocated stock is on gatepass but not linked to a trade yet. Allocated stock is tied to locked
            contracts.
          </p>
        </div>
        <Link href="/execution/movements" className="kastros-btn-primary inline-flex items-center gap-2 rounded-xl">
          <Truck className="h-4 w-4" />
          Truck Movements
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi icon={<Warehouse className="h-5 w-5" />} label="Net stock (qty)" value={totalStockLabel || "0"} tone="brand" />
        <Kpi icon={<Package className="h-5 w-5" />} label="Unallocated (qty)" value={totalUnallocatedLabel || "0"} tone="info" />
        <Kpi icon={<Boxes className="h-5 w-5" />} label="Allocated (qty)" value={totalAllocatedLabel || "0"} tone="success" />
        <Kpi icon={<Warehouse className="h-5 w-5" />} label="Warehouses" value={warehouses.length} tone="info" />
        <Kpi
          icon={<Banknote className="h-5 w-5" />}
          label="Total weighted purchase price"
          value={
            valuation
              ? `${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(valuation.weightedPurchasePricePkrPerMt)} PKR/MT`
              : "—"
          }
          tone="brand"
        />
        <Kpi
          icon={<ArrowUpFromLine className="h-5 w-5" />}
          label="Total sold quantity"
          value={valuation ? formatQtyWithUnit(valuation.totalSoldMt, "MT", 1) : "—"}
          tone="success"
        />
      </div>

      <section className="rounded-2xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="border-b px-5 py-4" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <h2 className="text-sm font-semibold text-foreground">Inventory by Location & Commodity</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Quantities by warehouse and commodity — unallocated vs allocated only.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                {["Warehouse", "Commodity", "Unit", "Unallocated", "Allocated", "Net"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {locationPagination.items.map((row, i) => (
                <tr
                  key={`${row.warehouseName}-${row.commodityCode}-${row.quantityUnit}`}
                  className="hover:bg-foreground/[0.02]"
                  style={{
                    borderBottom:
                      i < locationPagination.items.length - 1 ? "1px solid rgba(255,255,255,0.04)" : undefined,
                  }}
                >
                  <td className="px-4 py-3 text-muted-foreground">{row.warehouseName}</td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-foreground">{row.commodityCode}</div>
                    <div className="text-muted-foreground">{row.commodityName}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{row.quantityUnit}</td>
                  <td className="px-4 py-3 tabular-nums text-amber-400">
                    {formatQtyWithUnit(row.unallocatedQty, row.quantityUnit, 2)}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-emerald-400">
                    {formatQtyWithUnit(row.allocatedQty, row.quantityUnit, 2)}
                  </td>
                  <td className="px-4 py-3 tabular-nums font-semibold text-brand">
                    {formatQtyWithUnit(row.netQty, row.quantityUnit, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && locationCommodityRows.length === 0 && <Empty label="No inventory at warehouses yet" />}
        </div>
        <ListPagination
          page={locationPagination.page}
          totalPages={locationPagination.totalPages}
          totalItems={locationPagination.totalItems}
          startIndex={locationPagination.startIndex}
          endIndex={locationPagination.endIndex}
          onPageChange={locationPagination.setPage}
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Warehouse Balances</h2>
          <div className="flex items-center gap-3">
            <Link href="/execution/warehouses" className="text-xs font-medium text-brand hover:underline">
              Setup capacity
            </Link>
            <span className="text-xs text-muted-foreground">
              {warehouses.length} warehouse{warehouses.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {warehousePagination.items.map((w) => (
            <div key={w.name} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Warehouse className="h-4 w-4 text-brand" />
                    <h3 className="truncate text-sm font-semibold text-foreground">{w.name}</h3>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Unallocated {formatQtyWithUnit(w.unallocatedMt, "MT", 1)} · Allocated{" "}
                    {formatQtyWithUnit(w.allocatedMt, "MT", 1)}
                  </p>
                </div>
                <div className="text-right">
                  {(() => {
                    const units = new Set(Array.from(w.commodities.values()).map((c) => c.unit));
                    const netLabel =
                      units.size === 1
                        ? formatQtyWithUnit(w.netMt, [...units][0] ?? "MT", 2)
                        : summarizeQtyByUnit(
                            [...w.commodities.values()]
                              .filter((c) => Math.abs(c.qty) > 0.001)
                              .map((c) => ({ qty: c.qty, unit: c.unit })),
                            2,
                          ) || "—";
                    return (
                      <>
                        <div className="text-lg font-bold tabular-nums text-brand">{netLabel}</div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">net</div>
                      </>
                    );
                  })()}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <Mini
                  label="Unallocated"
                  value={formatQtyWithUnit(w.unallocatedMt, "MT", 1)}
                  tone="brand"
                />
                <Mini label="Allocated" value={formatQtyWithUnit(w.allocatedMt, "MT", 1)} tone="success" />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {Array.from(w.commodities.values())
                  .filter((c) => Math.abs(c.qty) > 0.001)
                  .slice(0, 6)
                  .map((c) => (
                    <span
                      key={`${c.code}-${c.unit}`}
                      className="rounded-full bg-foreground/5 px-2 py-1 text-[10px] font-semibold text-foreground"
                      title={`Unalloc ${c.unallocated.toFixed(1)} · Alloc ${c.allocated.toFixed(1)}`}
                    >
                      {c.code}: {formatQtyWithUnit(c.qty, c.unit, 1)}
                    </span>
                  ))}
              </div>
              {(() => {
                const cfg = warehouseConfigByName.get(w.name);
                const capSqFt = cfg?.capacitySqFt ?? 0;
                if (!capSqFt) return null;
                const capacity = {
                  capacitySqFt: capSqFt,
                  balesDivisionSqFt: cfg?.balesDivisionSqFt ?? 4.5,
                  grainDivisionSqFt: cfg?.grainDivisionSqFt ?? 7,
                };
                const stock = aggregateWarehouseStock(
                  [...w.commodities.values()].map((c) => ({
                    commodityCode: c.code,
                    quantityUnit: c.unit,
                    netQty: c.qty,
                  })),
                );
                const util = warehouseUtilizationSummary(stock, capacity);
                return (
                  <div className="mt-3 rounded-xl border border-border bg-foreground/[0.02] p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-subtle">Sq ft utilization (shared)</span>
                      <span className="font-semibold text-muted-foreground">
                        {(util.utilizationPct * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/10">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(util.utilizationPct * 100, 100)}%`,
                          background:
                            util.utilizationPct > 0.9
                              ? "#f87171"
                              : util.utilizationPct > 0.75
                                ? "#fbbf24"
                                : "#34d399",
                        }}
                      />
                    </div>
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
        {!loading && warehouses.length === 0 && <Empty label="No warehouse movements yet" />}
        <ListPagination
          page={warehousePagination.page}
          totalPages={warehousePagination.totalPages}
          totalItems={warehousePagination.totalItems}
          startIndex={warehousePagination.startIndex}
          endIndex={warehousePagination.endIndex}
          onPageChange={warehousePagination.setPage}
          className="rounded-2xl border border-border bg-card"
        />
      </section>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  tone: "brand" | "success" | "info";
}) {
  const toneClass =
    tone === "brand" ? "exec-kpi-accent" : tone === "success" ? "exec-kpi-success" : "exec-kpi-info";
  const valueClass =
    tone === "brand" ? "text-brand" : tone === "success" ? "text-success" : "text-info";
  return (
    <div className={cn("exec-kpi", toneClass)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="exec-kpi-label">{label}</div>
          <div className={cn("exec-kpi-value", valueClass)}>{value}</div>
        </div>
        <div className={cn("rounded-xl bg-card/60 p-2", valueClass)}>{icon}</div>
      </div>
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone: "brand" | "success" }) {
  const box = tone === "brand" ? "exec-stat-accent" : "exec-stat-success";
  const valueClass = tone === "brand" ? "text-brand" : "text-success";
  return (
    <div className={cn("rounded-xl px-3 py-2", box)}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 text-sm font-bold tabular-nums", valueClass)}>{value}</div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-5 py-12 text-center">
      <Truck className="mb-2 h-8 w-8 text-muted-foreground" />
      <p className="text-sm text-subtle">{label}</p>
    </div>
  );
}
