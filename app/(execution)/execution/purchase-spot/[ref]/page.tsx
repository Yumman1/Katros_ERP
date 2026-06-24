"use client";

import { invalidateTradeFlowCaches } from "@/lib/invalidate-caches";
import { trpc } from "@/lib/trpc/client";
import { formatQtyWithUnit } from "@/lib/formatters/numbers";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

type SpotState = "CONTRACT" | "SELECTED" | "LOADED" | "DC_ISSUED" | "INVOICED" | "ON_THE_WAY" | "RECEIVED";

const PIPELINE: { key: SpotState; label: string; desc: string }[] = [
  { key: "CONTRACT",    label: "Contract",    desc: "Trade locked, awaiting selector" },
  { key: "SELECTED",   label: "Selected",    desc: "Goods selected at Mandi/market" },
  { key: "LOADED",     label: "Loaded",      desc: "Vehicle loaded by broker" },
  { key: "DC_ISSUED",  label: "DC Issued",   desc: "Delivery Challan issued by seller" },
  { key: "INVOICED",   label: "Invoiced",    desc: "Broker invoice received" },
  { key: "ON_THE_WAY", label: "On the Way",  desc: "Vehicle en route to warehouse" },
  { key: "RECEIVED",   label: "Received",    desc: "Arrived and weighed at warehouse" },
];

const fmtPKR = (n: number) =>
  "₨ " + new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(n);
const fmtKg = (n: number) =>
  new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(n) + " kg";

export default function PurchaseSpotDetailPage() {
  const params = useParams();
  const tradeRef = decodeURIComponent(params.ref as string);
  const utils = trpc.useUtils();
  const { data } = trpc.execution.contractByRef.useQuery({ tradeRef });
  const advance = trpc.execution.advanceSpot.useMutation({ onSuccess: () => invalidateTradeFlowCaches(utils, tradeRef) });
  const submitFinance = trpc.execution.submitSpotForFinance.useMutation({ onSuccess: () => invalidateTradeFlowCaches(utils, tradeRef) });

  const [broker, setBroker] = useState("");
  const [dcNo, setDcNo] = useState("");
  const [truck, setTruck] = useState("");
  const [spotKg, setSpotKg] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [invoiceAmt, setInvoiceAmt] = useState("");
  const [receiveKg, setReceiveKg] = useState("");
  const [notes, setNotes] = useState("");

  if (!data?.contract) return <div className="flex h-64 items-center justify-center text-sm text-zinc-500">Loading…</div>;

  const c = data.contract;
  const unit = c.quantityUnit;
  const spot = data.spot;
  const currentState = spot?.state ?? "CONTRACT";
  const currentIdx = PIPELINE.findIndex((p) => p.key === currentState);

  function handleAdvance(toState: SpotState) {
    advance.mutate({
      tradeRef,
      state: toState,
      brokerName: broker || undefined,
      dcNo: dcNo || undefined,
      truckNo: truck || undefined,
      spotWeightKg: parseFloat(spotKg) || undefined,
      brokerInvoiceRef: invoiceRef || undefined,
      invoiceAmount: parseFloat(invoiceAmt) || undefined,
      warehouseReceiveWeightKg: parseFloat(receiveKg) || undefined,
      selectorNotes: notes || undefined,
    });
  }

  const spotKgNum = parseFloat(spot?.spotWeightKg?.toString() ?? "0") || 0;
  const receiveKgNum = parseFloat(spot?.warehouseReceiveWeightKg?.toString() ?? "0") || 0;
  const variance = spot?.weightVarianceKg ?? null;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs" style={{ color: "#71717a" }}>
        <Link href="/execution" className="hover:text-white">Desk</Link><span>/</span>
        <Link href="/execution/purchase-spot" className="hover:text-white">Purchase (Spot)</Link><span>/</span>
        <span style={{ color: "#a1a1aa" }}>{tradeRef}</span>
      </div>

      {/* Contract header */}
      <div className="rounded-2xl p-5" style={{ background: "rgba(96,165,250,0.05)", border: "1px solid rgba(96,165,250,0.12)" }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-mono text-xl font-bold" style={{ color: "#60a5fa" }}>{c.tradeRef}</h1>
            <p className="mt-0.5 text-sm font-medium text-white">{c.counterpartyName}</p>
            <p className="mt-0.5 text-xs" style={{ color: "#71717a" }}>
              {formatQtyWithUnit(c.contractualQtyMt, unit, 2)} · {c.warehouseDefault ?? "—"} · PKR {c.ratePerMaund?.toFixed(0) ?? "—"}/Maund
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider" style={{ color: "#52525b" }}>Current Stage</div>
            <div className="mt-1 text-lg font-bold" style={{ color: "#60a5fa" }}>{PIPELINE[currentIdx]?.label ?? currentState}</div>
            <div className="text-xs" style={{ color: "#71717a" }}>{PIPELINE[currentIdx]?.desc}</div>
          </div>
        </div>
      </div>

      {/* Pipeline stepper */}
      <div className="rounded-2xl p-5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider" style={{ color: "#71717a" }}>Spot Pipeline</h2>
        <div className="relative">
          {/* Track */}
          <div className="absolute left-0 top-4 h-0.5 w-full" style={{ background: "rgba(255,255,255,0.06)" }} />
          <div className="absolute left-0 top-4 h-0.5 transition-all duration-500"
            style={{ background: "#60a5fa", width: `${(currentIdx / (PIPELINE.length - 1)) * 100}%` }} />
          {/* Steps */}
          <div className="relative flex justify-between">
            {PIPELINE.map((p, i) => {
              const done = i < currentIdx;
              const active = i === currentIdx;
              return (
                <div key={p.key} className="flex flex-col items-center gap-1.5" style={{ flex: "0 0 auto", width: `${100 / PIPELINE.length}%` }}>
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all`}
                    style={{
                      background: done ? "#60a5fa" : active ? "#1e3a5f" : "#0f1117",
                      borderColor: done || active ? "#60a5fa" : "rgba(255,255,255,0.1)",
                      color: done || active ? (done ? "#000" : "#60a5fa") : "#52525b",
                    }}>
                    {done ? "✓" : i + 1}
                  </div>
                  <div className="text-center">
                    <div className="text-[9px] font-semibold uppercase" style={{ color: done || active ? "#60a5fa" : "#52525b" }}>{p.label}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Existing spot details */}
      {spot && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {spot.brokerName && <InfoCard label="Broker" value={spot.brokerName} />}
          {spot.dcNo && <InfoCard label="DC No." value={spot.dcNo} />}
          {spot.truckNo && <InfoCard label="Truck No." value={spot.truckNo} />}
          {spot.spotWeightKg && <InfoCard label="Spot Weight" value={fmtKg(spotKgNum)} />}
          {spot.brokerInvoiceRef && <InfoCard label="Invoice Ref" value={spot.brokerInvoiceRef} />}
          {spot.invoiceAmount && <InfoCard label="Invoice Amount" value={fmtPKR(spot.invoiceAmount)} color="#f59e0b" />}
          {spot.warehouseReceiveWeightKg && <InfoCard label="WH Receive Weight" value={fmtKg(receiveKgNum)} />}
          {variance !== null && (
            <InfoCard label="Weight Variance" value={`${variance >= 0 ? "+" : ""}${variance.toFixed(0)} kg`} color={variance < 0 ? "#f87171" : "#34d399"} />
          )}
          {spot.selectorNotes && <InfoCard label="Selector Notes" value={spot.selectorNotes} className="sm:col-span-2" />}
        </div>
      )}

      {/* Advance actions */}
      <div className="rounded-2xl p-5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <h2 className="mb-4 text-sm font-semibold text-white">Advance Stage</h2>

        {/* Context-sensitive fields */}
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          {currentState === "CONTRACT" && (
            <Inp label="Selector Notes" placeholder="Market selection details, grade observations…" value={notes} onChange={setNotes} />
          )}
          {(currentState === "SELECTED" || currentState === "LOADED") && (
            <>
              <Inp label="Broker Name" placeholder="Chaudhary Brokerage" value={broker} onChange={setBroker} />
              <Inp label="Truck No." placeholder="LEP-7712" value={truck} onChange={setTruck} />
              <Inp label="Spot Weight (kg)" placeholder="52000" value={spotKg} onChange={setSpotKg} type="number" />
            </>
          )}
          {currentState === "LOADED" && (
            <Inp label="DC No. (Delivery Challan)" placeholder="DC-88221" value={dcNo} onChange={setDcNo} />
          )}
          {currentState === "DC_ISSUED" && (
            <>
              <Inp label="Broker Invoice Ref" placeholder="INV-SPT-001" value={invoiceRef} onChange={setInvoiceRef} />
              <Inp label="Invoice Amount (PKR)" placeholder="5980000" value={invoiceAmt} onChange={setInvoiceAmt} type="number" />
            </>
          )}
          {currentState === "INVOICED" && (
            <div className="sm:col-span-2 rounded-xl p-3" style={{ background: "rgba(96,165,250,0.06)", border: "1px solid rgba(96,165,250,0.15)" }}>
              <p className="text-xs" style={{ color: "#60a5fa" }}>
                Vehicle is now invoiced. Click &quot;On the Way&quot; when the truck departs for the warehouse.
              </p>
            </div>
          )}
          {currentState === "ON_THE_WAY" && (
            <Inp label="Warehouse Receive Weight (kg)" placeholder="51800" value={receiveKg} onChange={setReceiveKg} type="number" />
          )}
        </div>

        {/* Next state button */}
        {currentIdx < PIPELINE.length - 1 && (
          <div className="flex flex-wrap gap-2">
            {PIPELINE.slice(currentIdx + 1, currentIdx + 2).map((nextStep) => (
              <button key={nextStep.key} onClick={() => handleAdvance(nextStep.key)} disabled={advance.isPending}
                className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-all hover:opacity-90 disabled:opacity-50"
                style={{ background: "linear-gradient(135deg,#60a5fa,#3b82f6)", color: "#000" }}>
                {advance.isPending ? "Saving…" : `→ ${nextStep.label}`}
              </button>
            ))}
            {/* Allow jumping to any future state */}
            {PIPELINE.slice(currentIdx + 2).map((s) => (
              <button key={s.key} onClick={() => handleAdvance(s.key)} disabled={advance.isPending}
                className="rounded-xl border px-3 py-2 text-xs font-medium text-zinc-400 transition-all hover:text-white"
                style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}>
                → {s.label}
              </button>
            ))}
          </div>
        )}

        {/* Final: received — submit to finance */}
        {currentState === "RECEIVED" && (
          <div className="space-y-3">
            <div className="rounded-xl p-4" style={{ background: "rgba(52,211,153,0.05)", border: "1px solid rgba(52,211,153,0.12)" }}>
              <p className="text-sm font-semibold text-green-400">✓ Goods received at warehouse</p>
              {variance !== null && (
                <p className="mt-1 text-xs" style={{ color: "#71717a" }}>
                  Weight variance: <span style={{ color: variance < 0 ? "#f87171" : "#34d399" }}>{variance >= 0 ? "+" : ""}{variance.toFixed(0)} kg</span>
                  {Math.abs(variance) > 500 && <span className="ml-2 text-red-400 font-medium">⚠ Large variance — review required</span>}
                </p>
              )}
            </div>
            <button onClick={() => submitFinance.mutate({ tradeRef })} disabled={submitFinance.isPending}
              className="w-full rounded-xl px-5 py-2.5 text-sm font-bold disabled:opacity-50"
              style={{ background: "linear-gradient(135deg,#f59e0b,#d97706)", color: "#000" }}>
              {submitFinance.isPending ? "Submitting…" : "Submit Payment to Finance"}
            </button>
            {advance.error && <p className="text-xs text-red-400">{advance.error.message}</p>}
          </div>
        )}

        {advance.error && <p className="mt-2 text-xs text-red-400">{advance.error.message}</p>}
      </div>
    </div>
  );
}

function InfoCard({ label, value, color, className }: { label: string; value: string; color?: string; className?: string }) {
  return (
    <div className={`rounded-xl p-3 ${className ?? ""}`} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="text-[10px] uppercase tracking-wider" style={{ color: "#52525b" }}>{label}</div>
      <div className="mt-0.5 text-sm font-semibold" style={{ color: color ?? "#e5e7eb" }}>{value}</div>
    </div>
  );
}

function Inp({ label, placeholder, value, onChange, type = "text" }: {
  label: string; placeholder?: string; value: string;
  onChange: (v: string) => void; type?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium" style={{ color: "#a1a1aa" }}>{label}</label>
      <input type={type} placeholder={placeholder} value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none"
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }} />
    </div>
  );
}
