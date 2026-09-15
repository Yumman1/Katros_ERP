"use client";

import { useRecordFilters } from "@/components/ui/record-filters";
import { field } from "@/lib/record-filters";

import { ExcelExportBar } from "@/components/execution/excel-export-bar";
import { WarehouseSubnav } from "@/components/execution/warehouse-subnav";
import { PageHeader } from "@/components/ui/page-header";
import { downloadExcel, endOfDay, parseDateInput } from "@/lib/export-excel";
import { WarehouseCapacityStats } from "@/components/execution/warehouse-capacity-stats";
import { WarehouseCostingSummaryCard } from "@/components/execution/warehouse-costing-fields";
import { computeWarehouseCosting, costingInputFromLocation } from "@/lib/warehouse-costing";
import { stockAsOf } from "@/lib/warehouse-stock-utils";
import { buildWarehouseUtilizationView } from "@/lib/warehouse-utilization";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { ListPagination } from "@/components/ui/list-pagination";
import { useListPagination } from "@/lib/use-list-pagination";
import { MapPin } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

export default function WarehouseUtilizationPage() {
  const { data: locations, isLoading } = trpc.execution.warehouseLocations.useQuery();
  const { data: contracts } = trpc.execution.lockedContracts.useQuery({});
  const { data: inbound } = trpc.execution.inboundReceipts.useQuery({});
  const { data: outbound } = trpc.execution.outboundDispatches.useQuery({});

  const [search, setSearch] = useState("");
  const [cityFilter, setCityFilter] = useState("ALL");
  const [minUtilPct, setMinUtilPct] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const contractByRef = useMemo(
    () =>
      new Map(
        (contracts ?? []).map((c) => [
          c.tradeRef,
          { commodityCode: c.commodityCode, quantityUnit: c.quantityUnit },
        ]),
      ),
    [contracts],
  );

  const asOfDate = useMemo(() => {
    const to = parseDateInput(dateTo);
    return to ? endOfDay(to) : null;
  }, [dateTo]);

  const enriched = useMemo(() => {
    return (locations ?? []).map((loc) => {
      const stock = stockAsOf(loc.name, inbound ?? [], outbound ?? [], contractByRef, asOfDate);
      const view = buildWarehouseUtilizationView(loc, stock);
      return { loc, stock, view };
    });
  }, [locations, inbound, outbound, contractByRef, asOfDate]);

  const cityOptions = useMemo(() => {
    const set = new Set<string>();
    for (const { loc } of enriched) if (loc.city?.trim()) set.add(loc.city.trim());
    return ["ALL", ...Array.from(set).sort()];
  }, [enriched]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const minUtil = minUtilPct ? Number(minUtilPct) / 100 : null;
    return enriched.filter(({ loc, view }) => {
      if (q) {
        const hay = [loc.name, loc.code, loc.city, loc.province, loc.lsp].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (cityFilter !== "ALL" && loc.city !== cityFilter) return false;
      if (minUtil != null && Number.isFinite(minUtil) && view && view.utilizationPct / 100 < minUtil)
        return false;
      return true;
    });
  }, [enriched, search, cityFilter, minUtilPct]);

  const filterKey = `${search}|${cityFilter}|${minUtilPct}|${dateFrom}|${dateTo}`;
  const listFilters = useRecordFilters("utilization", filtered.map((r) => ({ ...r, utilizationBand: !r.view ? "Not configured" : r.view.utilizationPct >= 100 ? "Full / over capacity" : r.view.utilizationPct <= 0 ? "Empty" : "Partially occupied" })), { fields: [field("warehouse", "Warehouse", "loc.name"), field("band", "Utilization", "utilizationBand")], searchPaths: ["loc.name", "loc.code", "loc.city"] });
  const utilizationPagination = useListPagination(listFilters.rows, { resetKey: filterKey + listFilters.resetKey });

  function exportExcel() {
    if (listFilters.rows.length === 0) return;
    const rows = listFilters.rows.map(({ loc, view }) => {
      const costing = computeWarehouseCosting(costingInputFromLocation(loc));
      return {
        Warehouse: loc.name,
        Code: loc.code ?? "",
        City: loc.city ?? "",
        StockMT: view?.stockMt.toFixed(2) ?? "",
        StockBales: view?.stockBales.toFixed(0) ?? "",
        GrainDivisionSqFt: view?.grainDivisionSqFt ?? "",
        BaleDivisionSqFt: view?.balesDivisionSqFt ?? "",
        UtilizationPct: view ? view.utilizationPct.toFixed(1) : "",
        AvailGrainMT: view ? view.availableGrainMt.toFixed(1) : "",
        AvailBaleAsGrainMT: view ? view.availableBaleAsGrainMt.toFixed(1) : "",
        UsedSqFt: view ? view.consumedSqFt.toFixed(0) : "",
        FreeSqFt: view ? view.remainingSqFt.toFixed(0) : "",
        TotalCostPkrMonth: costing ? costing.totalCostPkr.toFixed(0) : "",
        LoadedCostPerSqFt: costing ? costing.loadedCostPerSqFtPkr.toFixed(2) : "",
        CostPerMaundAt70Pct: costing ? costing.costPerMaundAt70PctPkr.toFixed(4) : "",
        CostPerMaundAt100Pct: costing ? costing.costPerMaundAt100PctPkr.toFixed(4) : "",
        StorageCapacityMT: costing ? costing.storageCapacityMt.toFixed(2) : "",
      };
    });
    downloadExcel(rows, "Warehouses", `warehouse-utilization-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <div className="kastros-desk-page">
      <PageHeader
        breadcrumb={
          <>
            <Link href="/execution/warehouses" className="hover:text-foreground">
              Warehouses
            </Link>
            <span>/</span>
            <span className="text-muted-foreground">Utilization</span>
          </>
        }
        title="Warehouse utilization & costing"
        subtitle="Physical stock, sq ft capacity usage, and monthly warehousing cost per maund."
      />

      <WarehouseSubnav />
      {listFilters.controls}

      <section className="exec-panel space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <span className="text-xs text-subtle">{filtered.length} of {enriched.length} locations</span>
          <ExcelExportBar
            from={dateFrom}
            to={dateTo}
            onFromChange={setDateFrom}
            onToChange={setDateTo}
            onExport={exportExcel}
            count={listFilters.rows.length}
            disabled={listFilters.rows.length === 0}
            label="Download Excel"
          />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[160px] flex-1 space-y-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-subtle">Search</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, code, city…"
              className="kastros-input w-full"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-subtle">City</span>
            <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} className="exec-filter">
              {cityOptions.map((c) => (
                <option key={c} value={c}>{c === "ALL" ? "All cities" : c}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-subtle">Min util %</span>
            <input
              type="number"
              min={0}
              max={100}
              value={minUtilPct}
              onChange={(e) => setMinUtilPct(e.target.value)}
              className="kastros-input w-24"
            />
          </label>
        </div>

        {isLoading ? (
          <div className="py-8 text-sm text-subtle">Loading…</div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {utilizationPagination.items.map(({ loc, view }) => (
              <div key={loc.id} className="exec-panel">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-secondary-muted text-accent-secondary">
                    <MapPin className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground">{loc.name}</div>
                    <div className="text-xs text-subtle">
                      {[loc.code, loc.city, loc.province].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                </div>
                {view ? (
                  <>
                    <WarehouseCapacityStats view={view} />
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-foreground/[0.08]">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          view.utilizationPct > 90
                            ? "bg-destructive"
                            : view.utilizationPct > 75
                              ? "bg-warning"
                              : "bg-success",
                        )}
                        style={{ width: `${Math.min(view.utilizationPct, 100)}%` }}
                      />
                    </div>
                  </>
                ) : (
                  <p className="mt-3 text-xs text-subtle">
                    No capacity configured — add sq ft and divisions in Warehouses → Setup.
                  </p>
                )}
                <WarehouseCostingSummaryCard
                  loc={loc}
                  actualUtilPct={view ? view.utilizationPct / 100 : null}
                  stockMt={view?.stockMt}
                />
              </div>
            ))}
          </div>
        )}
        <ListPagination
          page={utilizationPagination.page}
          totalPages={utilizationPagination.totalPages}
          totalItems={utilizationPagination.totalItems}
          startIndex={utilizationPagination.startIndex}
          endIndex={utilizationPagination.endIndex}
          onPageChange={utilizationPagination.setPage}
        />
      </section>
    </div>
  );
}
