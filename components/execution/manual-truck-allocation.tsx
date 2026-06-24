"use client";

import { formatQtyWithUnit } from "@/lib/formatters/numbers";
import { kgToQuantityUnit, quantityUnitToKg } from "@/lib/unit-conversion";
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

type Props = {
  mode: "INBOUND" | "OUTBOUND";
  trucks: PendingTruck[];
  contracts: Contract[];
  detailBasePath: string;
  accent: string;
  accentRgb: string;
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
  const cp = normCp(contract.counterpartyName);
  const names = [truck.counterpartyName, truck.brokerName].filter(Boolean).map((n) => normCp(n!));
  return names.some((n) => cp === n || cp.includes(n) || n.includes(cp));
}

function commodityMatchesTruck(truck: PendingTruck, contract: Contract): boolean {
  if (!truck.commodityCode?.trim()) return true;
  return contract.commodityCode === truck.commodityCode;
}

export function ManualTruckAllocation({
  mode,
  trucks,
  contracts,
  detailBasePath,
  accent,
  accentRgb,
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
      .filter((c) => commodityMatchesTruck(selectedTruck, c));
  }, [openOrders, selectedTruck]);

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

  function suggestMax(tradeRef: string, openQty: number, unit: string) {
    if (!selectedTruck) return;
    const max = maxAllocatable(selectedTruck, openQty, unit);
    setQty(tradeRef, max > 0 ? String(Number(max.toFixed(3))) : "");
  }

  function submitAllocation(tradeRef: string, openQty: number, unit: string) {
    if (!selectedTruck) return;
    const raw = parseFloat(qtyByTrade[tradeRef] ?? "");
    if (!raw || raw <= 0) return;
    const max = maxAllocatable(selectedTruck, openQty, unit);
    const allocateQty = Math.min(raw, max);
    const kg = quantityUnitToKg(allocateQty, unit);
    onAssign(selectedTruck.id, tradeRef, kg);
    setQtyByTrade((s) => ({ ...s, [tradeRef]: "" }));
  }

  function orderMatchesTruck(c: Contract) {
    if (!selectedTruck) return false;
    return counterpartyMatchesTruck(selectedTruck, c) && commodityMatchesTruck(selectedTruck, c);
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-400">
        {mode === "INBOUND"
          ? "Gate weight is in kg. Allocate in each order's booked unit — the contract open balance updates in that same unit."
          : "Gate weight is in kg. Allocate in each sale order's booked unit — dispatched qty is deducted from the contract open balance."}
      </p>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Open {mode === "INBOUND" ? "purchase" : "sale"} orders ({openOrders.length})
        </h3>
        {openOrders.length === 0 ? (
          <div
            className="rounded-2xl p-6 text-center text-sm text-zinc-500"
            style={{ border: "1px solid rgba(255,255,255,0.06)" }}
          >
            No open orders right now. Fully delivered contracts move off this list but stay on{" "}
            <Link href="/execution/contracts" className="text-amber-400 hover:underline">
              Locked Contracts
            </Link>
            .
          </div>
        ) : (
          <div
            className="overflow-x-auto rounded-2xl"
            style={{ border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wider text-zinc-500">
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Counterparty</th>
                  <th className="px-4 py-3">Commodity</th>
                  <th className="px-4 py-3">Unit</th>
                  <th className="px-4 py-3">Contract</th>
                  <th className="px-4 py-3">{fulfilledLabel}</th>
                  <th className="px-4 py-3">Open</th>
                  {selectedTruck && <th className="px-4 py-3">Allocate</th>}
                </tr>
              </thead>
              <tbody>
                {openOrders.map((c) => {
                  const canAllocate = selectedTruck && orderMatchesTruck(c);
                  const unit = c.quantityUnit;
                  const openQty = c.openQtyMt;
                  const maxQty = canAllocate && selectedTruck ? maxAllocatable(selectedTruck, openQty, unit) : 0;
                  return (
                    <tr
                      key={c.tradeRef}
                      className="border-b border-white/5 hover:bg-white/[0.02]"
                      style={canAllocate ? { background: `${accentRgb}08` } : undefined}
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`${detailBasePath}/${encodeURIComponent(c.tradeRef)}`}
                          className="font-mono font-semibold hover:underline"
                          style={{ color: accent }}
                        >
                          {c.tradeRef}
                        </Link>
                        <div className="text-xs text-zinc-500">{c.warehouseDefault ?? "—"}</div>
                      </td>
                      <td className="px-4 py-3 text-zinc-300">{c.counterpartyName}</td>
                      <td className="px-4 py-3 text-zinc-300">
                        {c.commodityName}
                        <span className="text-zinc-600"> ({c.commodityCode})</span>
                      </td>
                      <td className="px-4 py-3 font-medium text-zinc-400">{unit}</td>
                      <td className="px-4 py-3 text-zinc-400">
                        {formatQtyWithUnit(c.contractualQtyMt, unit, 2)}
                      </td>
                      <td className="px-4 py-3 text-sky-400">
                        {formatQtyWithUnit(c.receivedQtyMt, unit, 2)}
                      </td>
                      <td className="px-4 py-3 font-semibold text-white">
                        {formatQtyWithUnit(openQty, unit, 2)}
                      </td>
                      {selectedTruck && (
                        <td className="px-4 py-3">
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
                                className="w-32 rounded-lg border border-white/10 bg-[#161a22] px-2 py-1.5 text-sm text-white outline-none focus:border-amber-400/50 disabled:opacity-50"
                              />
                              <button
                                type="button"
                                disabled={maxQty <= 0 || isAssigning}
                                onClick={() => suggestMax(c.tradeRef, openQty, unit)}
                                className="rounded-lg border border-white/10 px-2 py-1 text-xs text-zinc-400 hover:text-white disabled:opacity-40"
                              >
                                Fill max
                              </button>
                              <button
                                type="button"
                                disabled={
                                  maxQty <= 0 ||
                                  isAssigning ||
                                  !parseFloat(qtyForTrade(c.tradeRef) || "0")
                                }
                                onClick={() => submitAllocation(c.tradeRef, openQty, unit)}
                                className="rounded-lg px-3 py-1 text-xs font-bold text-black disabled:opacity-40"
                                style={{ background: `linear-gradient(135deg,${accent},${accentRgb}cc)` }}
                              >
                                {isAssigning ? "…" : "Allocate"}
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-zinc-600">Needs matching truck</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Trucks at gate ({activeTrucks.length})
        </h3>
        {activeTrucks.length === 0 ? (
          <div
            className="rounded-2xl p-6 text-center text-sm text-zinc-500"
            style={{ border: "1px solid rgba(255,255,255,0.06)" }}
          >
            No trucks waiting for assignment. Open orders above stay listed — add a gatepass when the next truck
            arrives.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {activeTrucks.map((t) => {
              const active = (selectedTruck?.id ?? activeTrucks[0]?.id) === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setSelectedTruckId(t.id);
                    onClearError?.();
                  }}
                  className="rounded-xl px-4 py-3 text-left transition-all"
                  style={{
                    background: active ? `${accentRgb}14` : "rgba(255,255,255,0.02)",
                    border: `1px solid ${active ? `${accentRgb}55` : "rgba(255,255,255,0.08)"}`,
                  }}
                >
                  <div className="font-mono text-sm font-bold" style={{ color: accent }}>
                    {t.gatepassNo}
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-400">
                    {t.truckNo} · {t.commodityName ?? "—"}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-amber-400">
                    {formatQtyWithUnit(t.remainingKg, "KG", 0)} left on truck
                  </div>
                  {t.status === "PARTIAL" && (
                    <span className="mt-1 inline-block text-[10px] font-bold uppercase text-sky-400">
                      Partially allocated
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {selectedTruck && (
        <div
          className="rounded-2xl p-4"
          style={{ background: `${accentRgb}0a`, border: `1px solid ${accentRgb}33` }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-white">
                <Truck className="h-4 w-4" style={{ color: accent }} />
                <span className="font-semibold">{selectedTruck.truckNo}</span>
                <span className="text-zinc-500">·</span>
                <span className="text-sm text-zinc-300">{selectedTruck.counterpartyName}</span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                {selectedTruck.warehouseName} · {selectedTruck.commodityName} ({selectedTruck.commodityCode})
                · Builty: {selectedTruck.builtyDetails ?? "—"}
              </p>
              <p className="mt-1 text-xs text-zinc-600">
                {matchingOrders.length} matching open order{matchingOrders.length === 1 ? "" : "s"} — enter qty in
                each order&apos;s unit in the table above
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold tabular-nums text-amber-400">
                {formatQtyWithUnit(selectedTruck.remainingKg, "KG", 0)}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">remaining on truck (kg)</div>
            </div>
          </div>
        </div>
      )}

      {successMessage && (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-400">
          {successMessage}
        </p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
