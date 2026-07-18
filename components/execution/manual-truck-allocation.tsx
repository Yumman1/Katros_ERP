"use client";

import { formatQtyWithUnit } from "@/lib/formatters/numbers";
import { kgToQuantityUnit, quantityUnitToKg } from "@/lib/unit-conversion";
import { contractMatchesWarehouse, allocationSummaryLabel } from "@/lib/warehouse-allocation";
import { warehouseOpenQtyAt } from "@/components/execution/warehouse-split-allocation";
import { deliveryWindowStatus, DELIVERY_WINDOW_TONE } from "@/lib/delivery-window";
import { cn } from "@/lib/utils";
import { ListPagination } from "@/components/ui/list-pagination";
import { useListPagination } from "@/lib/use-list-pagination";
import { Truck } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

type Contract = {
  tradeRef: string;
  counterpartyName: string;
  commodityCode: string;
  commodityName: string;
  quantityUnit: string;
  contractualQtyMt: number;
  receivedQtyMt: number;
  openQtyMt: number;
  warehouseDefault?: string | null;
  allocatedWarehouse?: string | null;
  warehouseAllocations?: { warehouseName: string; qtyMt: number }[] | null;
  warehouseAllocationProgress?: {
    warehouseName: string;
    qtyMt: number;
    fulfilledQtyMt: number;
    openQtyMt: number;
  }[];
  contractStatus?: string;
  deliveryStart?: Date | string | null;
  deliveryEnd?: Date | string | null;
};

type PendingTruck = {
  id: string;
  gatepassNo: string;
  truckNo: string;
  counterpartyName: string;
  brokerName?: string | null;
  commodityCode?: string | null;
  commodityName?: string | null;
  warehouseName: string;
  remainingKg: number;
  status: string;
  builtyDetails?: string | null;
  arrivalDate: Date | string;
};

type AccentVariant = "success" | "warning" | "info";

const ACCENT_TEXT: Record<AccentVariant, string> = {
  success: "text-success",
  warning: "text-accent-secondary",
  info: "text-info",
};

const ROW_HIGHLIGHT: Record<AccentVariant, string> = {
  success: "exec-row-highlight-success",
  warning: "exec-row-highlight-warning",
  info: "exec-row-highlight-info",
};

const TRUCK_ACTIVE: Record<AccentVariant, string> = {
  success: "exec-truck-chip-active-success",
  warning: "exec-truck-chip-active",
  info: "exec-truck-chip-active-info",
};

const TRUCK_DETAIL: Record<AccentVariant, string> = {
  success: "exec-truck-detail-success",
  warning: "exec-truck-detail",
  info: "exec-truck-detail-info",
};

type Props = {
  mode: "INBOUND" | "OUTBOUND";
  trucks: PendingTruck[];
  contracts: Contract[];
  detailBasePath: string;
  accentVariant?: AccentVariant;
  isAssigning: boolean;
  error: string | null;
  successMessage?: string | null;
  onAssign: (truckId: string, tradeRef: string, weightKg: number) => void;
  onClearError?: () => void;
};


function normCp(s: string) {
  return s.trim().toLowerCase();
}

function counterpartyMatchesTruck(truck: PendingTruck, contract: Contract): boolean {
  return normCp(contract.counterpartyName) === normCp(truck.counterpartyName);
}

function commodityMatchesTruck(truck: PendingTruck, contract: Contract): boolean {
  if (!truck.commodityCode?.trim()) return true;
  return contract.commodityCode === truck.commodityCode;
}

function warehouseMatchesTruck(truck: PendingTruck, contract: Contract): boolean {
  return contractMatchesWarehouse(contract, truck.warehouseName);
}

export function ManualTruckAllocation({
  mode,
  trucks,
  contracts,
  detailBasePath,
  accentVariant = "warning",
  isAssigning,
  error,
  successMessage,
  onAssign,
  onClearError,
}: Props) {
  const activeTrucks = trucks.filter((t) => t.status === "PENDING" || t.status === "PARTIAL");
  const [selectedTruckId, setSelectedTruckId] = useState<string | null>(null);
  const [qtyByTrade, setQtyByTrade] = useState<Record<string, string>>({});

  const selectedTruck = activeTrucks.find((t) => t.id === selectedTruckId) ?? activeTrucks[0] ?? null;

  const openOrders = useMemo(
    () => contracts.filter((c) => c.openQtyMt > 0.001).sort((a, b) => a.tradeRef.localeCompare(b.tradeRef)),
    [contracts],
  );

  const matchingOrders = useMemo(() => {
    if (!selectedTruck) return [];
    return openOrders
      .filter((c) => counterpartyMatchesTruck(selectedTruck, c))
      .filter((c) => commodityMatchesTruck(selectedTruck, c))
      .filter((c) => warehouseMatchesTruck(selectedTruck, c))
      .filter((c) => warehouseOpenQtyAt(c, selectedTruck.warehouseName) > 0.001);
  }, [openOrders, selectedTruck]);

  const visibleOrders = selectedTruck ? matchingOrders : [];
  const ordersPagination = useListPagination(visibleOrders, { resetKey: selectedTruck?.id ?? "none" });
  const trucksPagination = useListPagination(activeTrucks);
  const fulfilledLabel = mode === "INBOUND" ? "Received" : "Dispatched";

  function qtyForTrade(tradeRef: string) {
    return qtyByTrade[tradeRef] ?? "";
  }

  function setQty(tradeRef: string, value: string) {
    onClearError?.();
    setQtyByTrade((s) => ({ ...s, [tradeRef]: value }));
  }

  function maxAllocatable(truck: PendingTruck, openQty: number, unit: string) {
    const truckInUnit = kgToQuantityUnit(truck.remainingKg, unit);
    return Math.min(truckInUnit, openQty);
  }

  function fillMaxInput(tradeRef: string, openQty: number, unit: string) {
    if (!selectedTruck) return;
    const max = maxAllocatable(selectedTruck, openQty, unit);
    setQty(tradeRef, max > 0 ? String(Number(max.toFixed(3))) : "");
  }

  function submitAllocation(tradeRef: string, openQty: number, unit: string, qtyOverride?: number) {
    if (!selectedTruck) return;
    const raw = qtyOverride ?? parseFloat(qtyByTrade[tradeRef] ?? "");
    if (!Number.isFinite(raw) || raw <= 0) {
      onClearError?.();
      return;
    }
    const max = maxAllocatable(selectedTruck, openQty, unit);
    if (max <= 0) return;
    const allocateQty = Math.min(raw, max);
    const kg = quantityUnitToKg(allocateQty, unit);
    if (!Number.isFinite(kg) || kg <= 0) return;
    onAssign(selectedTruck.id, tradeRef, kg);
    setQtyByTrade((s) => ({ ...s, [tradeRef]: "" }));
  }

  function allocateMax(tradeRef: string, openQty: number, unit: string) {
    if (!selectedTruck) return;
    const max = maxAllocatable(selectedTruck, openQty, unit);
    if (max <= 0) return;
    submitAllocation(tradeRef, openQty, unit, max);
  }

  function orderMatchesTruck(c: Contract) {
    if (!selectedTruck) return false;
    return (
      warehouseMatchesTruck(selectedTruck, c) &&
      counterpartyMatchesTruck(selectedTruck, c) &&
      commodityMatchesTruck(selectedTruck, c)
    );
  }

  return (
    <div className="kastros-desk-page">
      {error && (
        <p className="rounded-xl border border-destructive/30 bg-[color-mix(in_srgb,var(--destructive)_10%,transparent)] px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {successMessage && (
        <p className="rounded-xl border border-success/30 bg-[color-mix(in_srgb,var(--success)_10%,transparent)] px-4 py-3 text-sm text-success">
          {successMessage}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        {mode === "INBOUND"
          ? "Gate weight is in kg. Allocate in each order's booked unit — the contract open balance updates in that same unit."
          : "Gate weight is in kg. Allocate in each sale order's booked unit — dispatched qty is deducted from the contract open balance."}
      </p>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">
          {selectedTruck
            ? `Matching orders for ${selectedTruck.counterpartyName} (${visibleOrders.length})`
            : `Open ${mode === "INBOUND" ? "purchase" : "sale"} orders`}
        </h3>
        {!selectedTruck ? (
          <div className="exec-empty">
            Select a truck below to see open orders for the same counterparty and commodity.
          </div>
        ) : visibleOrders.length === 0 ? (
          <div className="exec-empty">
            No open orders match this truck&apos;s counterparty
            {selectedTruck.commodityCode ? `, commodity (${selectedTruck.commodityCode})` : ""}
            , and warehouse ({selectedTruck.warehouseName}). Confirm the trade is locked, allocated to
            this warehouse, and still open on{" "}
            <Link href="/execution/contracts" className="text-accent-secondary hover:underline">
              Reviewed Trades
            </Link>
            .
          </div>
        ) : (
          <div className="kastros-table-wrap">
            <table className="kastros-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Counterparty</th>
                  <th>Commodity</th>
                  <th>Unit</th>
                  <th>Contract</th>
                  <th>{fulfilledLabel}</th>
                  <th>Open</th>
                  {selectedTruck && <th>Allocate</th>}
                </tr>
              </thead>
              <tbody>
                {ordersPagination.items.map((c) => {
                  const canAllocate = selectedTruck && orderMatchesTruck(c);
                  const unit = c.quantityUnit;
                  const openQty =
                    selectedTruck && canAllocate
                      ? warehouseOpenQtyAt(c, selectedTruck.warehouseName)
                      : c.openQtyMt;
                  const maxQty = canAllocate && selectedTruck ? maxAllocatable(selectedTruck, openQty, unit) : 0;
                  return (
                    <tr
                      key={c.tradeRef}
                      className={canAllocate ? ROW_HIGHLIGHT[accentVariant] : undefined}
                    >
                      <td>
                        <Link
                          href={`${detailBasePath}/${encodeURIComponent(c.tradeRef)}`}
                          className={cn("font-mono font-semibold hover:underline", ACCENT_TEXT[accentVariant])}
                        >
                          {c.tradeRef}
                        </Link>
                        <div className="text-xs text-subtle">
                          {allocationSummaryLabel(c, unit)}
                        </div>
                        {(() => {
                          const dw = deliveryWindowStatus(c.deliveryStart, c.deliveryEnd, {
                            fulfilled: c.contractStatus === "Close",
                          });
                          if (dw.state === "NO_DATES") return null;
                          const tone = DELIVERY_WINDOW_TONE[dw.state];
                          return (
                            <span
                              className="mt-1 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase"
                              style={{ background: tone.bg, color: tone.color }}
                            >
                              {dw.label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="text-muted-foreground">{c.counterpartyName}</td>
                      <td className="text-muted-foreground">
                        {c.commodityName}
                        <span className="text-subtle"> ({c.commodityCode})</span>
                      </td>
                      <td className="font-medium text-muted-foreground">{unit}</td>
                      <td className="text-muted-foreground">
                        {formatQtyWithUnit(c.contractualQtyMt, unit, 2)}
                      </td>
                      <td className="text-info">{formatQtyWithUnit(c.receivedQtyMt, unit, 2)}</td>
                      <td className="font-semibold text-foreground">
                        {formatQtyWithUnit(openQty, unit, 2)}
                      </td>
                      {selectedTruck && (
                        <td>
                          {canAllocate ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="number"
                                step="0.001"
                                min={0}
                                max={maxQty}
                                value={qtyForTrade(c.tradeRef)}
                                onChange={(e) => setQty(c.tradeRef, e.target.value)}
                                placeholder={`max ${maxQty.toFixed(2)} ${unit}`}
                                disabled={maxQty <= 0 || isAssigning}
                                className="kastros-input kastros-input-sm w-32 disabled:opacity-50"
                              />
                              <button
                                type="button"
                                disabled={maxQty <= 0 || isAssigning}
                                onClick={() => fillMaxInput(c.tradeRef, openQty, unit)}
                                className="kastros-btn-secondary px-2 py-1 text-xs disabled:opacity-40"
                              >
                                Fill
                              </button>
                              <button
                                type="button"
                                disabled={maxQty <= 0 || isAssigning}
                                onClick={() => allocateMax(c.tradeRef, openQty, unit)}
                                className="kastros-btn-primary px-3 py-1 text-xs disabled:opacity-40"
                              >
                                {isAssigning ? "…" : "Allocate max"}
                              </button>
                              <button
                                type="button"
                                disabled={
                                  maxQty <= 0 ||
                                  isAssigning ||
                                  !Number.isFinite(parseFloat(qtyForTrade(c.tradeRef))) ||
                                  parseFloat(qtyForTrade(c.tradeRef)) <= 0
                                }
                                onClick={() => submitAllocation(c.tradeRef, openQty, unit)}
                                className="kastros-btn-secondary px-3 py-1 text-xs disabled:opacity-40"
                              >
                                {isAssigning ? "…" : "Allocate qty"}
                              </button>
                            </div>
                          ) : null}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <ListPagination
              page={ordersPagination.page}
              totalPages={ordersPagination.totalPages}
              totalItems={ordersPagination.totalItems}
              startIndex={ordersPagination.startIndex}
              endIndex={ordersPagination.endIndex}
              onPageChange={ordersPagination.setPage}
            />
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">
          Trucks at gate ({activeTrucks.length})
        </h3>
        {activeTrucks.length === 0 ? (
          <div className="exec-empty">
            No trucks waiting for assignment. Open orders above stay listed — add a gatepass when the next truck
            arrives.
          </div>
        ) : (
          <>
          <div className="flex flex-wrap gap-2">
            {trucksPagination.items.map((t) => {
              const active = (selectedTruck?.id ?? activeTrucks[0]?.id) === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setSelectedTruckId(t.id);
                    onClearError?.();
                  }}
                  className={cn("exec-truck-chip", active && TRUCK_ACTIVE[accentVariant])}
                >
                  <div className={cn("font-mono text-sm font-bold", ACCENT_TEXT[accentVariant])}>
                    {t.gatepassNo}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t.truckNo} · {t.commodityName ?? "—"}
                  </div>
                  <div className="mt-0.5 text-[10px] text-subtle">
                    {new Date(t.arrivalDate).toLocaleString("en-PK", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-accent-secondary">
                    {formatQtyWithUnit(t.remainingKg, "KG", 0)} left on truck
                  </div>
                  {t.status === "PARTIAL" && (
                    <span className="mt-1 inline-block text-[10px] font-bold uppercase text-info">
                      Partially allocated
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <ListPagination
            page={trucksPagination.page}
            totalPages={trucksPagination.totalPages}
            totalItems={trucksPagination.totalItems}
            startIndex={trucksPagination.startIndex}
            endIndex={trucksPagination.endIndex}
            onPageChange={trucksPagination.setPage}
          />
          </>
        )}
      </section>

      {selectedTruck && (
        <div className={TRUCK_DETAIL[accentVariant]}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-foreground">
                <Truck className={cn("h-4 w-4", ACCENT_TEXT[accentVariant])} />
                <span className="font-semibold">{selectedTruck.truckNo}</span>
                <span className="text-subtle">·</span>
                <span className="text-sm text-muted-foreground">{selectedTruck.counterpartyName}</span>
              </div>
              <p className="mt-1 text-xs text-subtle">
                {selectedTruck.warehouseName} · {selectedTruck.commodityName} ({selectedTruck.commodityCode})
                · Builty: {selectedTruck.builtyDetails ?? "—"}
              </p>
              <p className="mt-1 text-xs text-subtle">
                {matchingOrders.length} matching open order{matchingOrders.length === 1 ? "" : "s"} — enter qty in
                each order&apos;s unit in the table above
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold tabular-nums text-accent-secondary">
                {formatQtyWithUnit(selectedTruck.remainingKg, "KG", 0)}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-subtle">remaining on truck (kg)</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
