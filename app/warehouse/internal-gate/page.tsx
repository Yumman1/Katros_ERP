"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowDownToLine, ArrowUpFromLine, ClipboardList, Truck, User, Warehouse } from "lucide-react";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { GatepassField as Field, GatepassFormSection as Section, GatepassModeButton as Mode, gatepassInputClass as inputClass } from "@/components/warehouse/gatepass-form-fields";
import { isSesameCommodity } from "@/lib/sesame";

type Movement = { internalGateToken: string; transferRef: string; status: string; truckNo: string; fromWarehouseName: string | null; externalOrigin: string | null; toWarehouseName: string; commodityCode: string; commodityName: string; sesameType: string; dispatchedKg: number; biltyNo: string | null };
export default function Page() { return <Suspense fallback={<p>Loading internal gate…</p>}><Gate /></Suspense>; }
function Gate() {
  const params = useSearchParams();
  const token = params.get("token") ?? "", access = params.get("access") ?? "";
  const [direction, setDirection] = useState<"in" | "out">(params.get("direction") === "in" ? "in" : "out");
  const [rows, setRows] = useState<Movement[]>([]);
  const [warehouse, setWarehouse] = useState("");
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [kg, setKg] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const inbound = direction === "in", color = inbound ? "#10b981" : "#f59e0b";
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setRows([]);
    const query = new URLSearchParams(token ? { token } : { access });
    fetch(`/api/internal-gate?${query}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load internal trucks");
      if (!controller.signal.aborted) { setRows(token ? [{ ...data, internalGateToken: token }] : data.movements); if (token) setSelected(token); }
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, access, refresh]);
  const eligible = rows.filter(r => r.status === (inbound ? "IN_TRANSIT" : "DRAFT"));
  const warehouseFor = (r: Movement) => inbound ? r.toWarehouseName : r.fromWarehouseName ?? r.externalOrigin ?? "Outside warehouses";
  const warehouses = Array.from(new Set(eligible.map(warehouseFor))).sort();
  const row = rows.find(r => r.internalGateToken === selected);
  const canSubmit = !!row && eligible.includes(row) && name.trim().length > 0 && (!inbound || Number(kg) > 0);
  function changeDirection(next: "in" | "out") { setDirection(next); setWarehouse(""); setSelected(token); setKg(""); setSuccess(""); }
  return <main className="min-h-screen bg-background p-5 text-foreground sm:p-7"><div className="mx-auto max-w-7xl space-y-5">
    <header className="flex items-start justify-between gap-4 border-b border-border pb-5"><div><p className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-500"><ClipboardList className="h-4 w-4" />KASTROS SUPPLY CHAIN</p><h1 className="text-2xl font-semibold">Internal Warehouse Gate Register</h1><p className="mt-2 text-sm text-muted-foreground">Select warehouse first, then the booked internal truck. Gate out dispatches the shift; gate in records its received weight.</p></div><ThemeToggle /></header>
    <div className="flex gap-2 rounded-2xl border border-border p-1.5"><Mode active={inbound} onClick={() => changeDirection("in")} icon={<ArrowDownToLine className="h-4 w-4" />} label="Inbound (Gate In)" color="#10b981" /><Mode active={!inbound} onClick={() => changeDirection("out")} icon={<ArrowUpFromLine className="h-4 w-4" />} label="Outbound (Gate Out)" color="#f59e0b" /></div>
    <form className="space-y-5" onSubmit={async event => {
      event.preventDefault(); if (!canSubmit || busy || !row) return;
      setBusy(true); setError(""); setSuccess("");
      try {
        const response = await fetch("/api/internal-gate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: row.internalGateToken, direction, recordedBy: name, ...(inbound ? { receivedKg: Number(kg) } : {}) }) });
        const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Could not save gate entry");
        setSuccess(`Internal gate ${direction} recorded: ${data.gatepassNo}`); setSelected(token); setKg(""); setRefresh(v => v + 1);
      } catch (e) { setError(e instanceof Error ? e.message : "Could not save gate entry"); } finally { setBusy(false); }
    }}>
      <Section title="Register" icon={<User className="h-4 w-4" />} color={color}><p className="mb-3 text-sm text-muted-foreground">Gate date and time are recorded automatically on submit.</p><Field label="Recorded by" required hint="warehouse manager or staff"><input aria-label="Recorded by" required maxLength={120} className={inputClass} placeholder="Your full name" value={name} onChange={e => setName(e.target.value)} /></Field></Section>
      <Section title="Warehouse" icon={<Warehouse className="h-4 w-4" />} color={color}><Field label={inbound ? "Receiving warehouse" : "Dispatch warehouse"} required>{token && row ? <input className={inputClass} readOnly value={warehouseFor(row)} /> : <select aria-label="Warehouse" required className={inputClass} disabled={loading} value={warehouse} onChange={e => { setWarehouse(e.target.value); setSelected(""); setKg(""); }}><option value="">Select warehouse…</option>{warehouses.map(w => <option key={w}>{w}</option>)}</select>}</Field></Section>
      <Section title="Internal truck" icon={<Truck className="h-4 w-4" />} color={color}><div className="grid gap-3 sm:grid-cols-2">
        <Field label="Booked shift / truck" required>{token && row ? <input className={inputClass} readOnly value={`${row.transferRef} · ${row.truckNo}`} /> : <select aria-label="Booked shift / truck" required className={inputClass} disabled={!warehouse || loading} value={selected} onChange={e => { setSelected(e.target.value); setKg(""); }}><option value="">Select internal truck…</option>{eligible.filter(r => warehouseFor(r) === warehouse).map(r => <option key={r.internalGateToken} value={r.internalGateToken}>{r.transferRef} · {r.truckNo}</option>)}</select>}</Field>
        {row && <><Field label="Commodity"><input className={inputClass} readOnly value={row.commodityName} /></Field><Field label="From"><input className={inputClass} readOnly value={row.fromWarehouseName ?? row.externalOrigin ?? "—"} /></Field><Field label="To"><input className={inputClass} readOnly value={row.toWarehouseName} /></Field><Field label="Bilty number"><input className={inputClass} readOnly value={row.biltyNo ?? "—"} /></Field><Field label="Dispatch weight (kg)"><input className={inputClass} readOnly value={row.dispatchedKg.toLocaleString()} /></Field>{isSesameCommodity(row.commodityCode) && <Field label="Sesame type"><input className={inputClass} readOnly value={row.sesameType} /></Field>}{inbound && <Field label="Received warehouse weight (kg)" required><input aria-label="Received warehouse weight (kg)" required type="number" min="0.001" step="0.001" className={inputClass} value={kg} onChange={e => setKg(e.target.value)} /></Field>}</>}
      </div></Section>
      {loading && <p role="status">Loading internal trucks…</p>}{!loading && !error && !eligible.length && <p>No internal trucks are awaiting gate {direction}.</p>}{error && <p role="alert" className="text-destructive">{error}</p>}{success && <p role="status" className="text-success">{success}</p>}
      <button disabled={!canSubmit || busy || loading} className="kastros-btn-primary disabled:opacity-50">{busy ? "Saving…" : `Record internal gate ${direction}`}</button>
    </form>
  </div></main>;
}
