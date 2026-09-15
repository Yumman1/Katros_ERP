"use client";

import { useRecordFilters } from "@/components/ui/record-filters";
import { field } from "@/lib/record-filters";
import type { LocationCommodityInventoryRow } from "@/lib/inventory-stock";
import { formatQtyWithUnit } from "@/lib/formatters/numbers";
import { ListPagination } from "@/components/ui/list-pagination";
import { useListPagination } from "@/lib/use-list-pagination";

export function LocationCommodityTable({
  rows,
  loading,
}: {
  rows: LocationCommodityInventoryRow[];
  loading?: boolean;
}) {
  const listFilters = useRecordFilters("inventory", rows, { fields: [field("warehouse", "Warehouse", "warehouseName"), field("commodity", "Commodity", "commodityCode")], searchPaths: ["warehouseName", "commodityCode", "commodityName"] });
  const pagination = useListPagination(listFilters.rows, { resetKey: listFilters.resetKey });

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">Inventory by Location & Commodity</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Current stock across all warehouses — unallocated vs allocated.
        </p>
      </div>
      {listFilters.controls}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
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
            {loading && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-sm text-subtle">
                  Loading inventory…
                </td>
              </tr>
            )}
            {!loading &&
              pagination.items.map((row) => (
              <tr
                key={`${row.warehouseName}-${row.commodityCode}-${row.quantityUnit}`}
                className="border-b border-border/60 last:border-0 hover:bg-foreground/[0.02]"
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
                <td
                  className={`px-4 py-3 tabular-nums font-semibold ${
                    row.netQty < -0.001 ? "text-destructive" : "text-brand"
                  }`}
                >
                  {formatQtyWithUnit(row.netQty, row.quantityUnit, 2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && rows.length === 0 && (
          <p className="px-5 py-8 text-center text-sm text-subtle">No inventory at warehouses yet.</p>
        )}
      </div>
      <ListPagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.totalItems}
        startIndex={pagination.startIndex}
        endIndex={pagination.endIndex}
        onPageChange={pagination.setPage}
      />
    </section>
  );
}
