"use client";

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Loader2,
  Truck,
  User,
  Warehouse,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

const RECORDED_BY_KEY = "kastros-gatepass-recorded-by";

type GatepassCommodity = {
  code: string;
  name: string;
};

type GatepassCounterparty = {
  name: string;
  code: string;
  openTradeCount: number;
  commodities: GatepassCommodity[];
};

type ReferenceData = {
  warehouses: string[];
  inboundCounterparties: GatepassCounterparty[];
  outboundCounterparties: GatepassCounterparty[];
};

type MovementType = "INBOUND" | "OUTBOUND";

const emptyForm = {
  movementType: "INBOUND" as MovementType,
  recordedByName: "",
  counterpartyName: "",
  commodityCode: "",
  brokerName: "",
  builtyDetails: "",
  warehouseName: "",
  gatepassNo: "",
  truckNo: "",
  driverName: "",
  driverPhone: "",
  weightKg: "",
  bags: "",
  remarks: "",
};

const inputClass =
  "w-full rounded-xl border border-white/10 bg-[#161a22] px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-amber-400/50 transition-colors placeholder:text-zinc-500";

function formatGateTimestamp(d: Date) {
  return d.toLocaleString("en-PK", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function WarehouseGatepassPage() {
  const [reference, setReference] = useState<ReferenceData>({
    warehouses: [],
    inboundCounterparties: [],
    outboundCounterparties: [],
  });
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ gatepassNo: string; truckNo: string; at: string } | null>(
    null,
  );
  const gateTimestamp = useMemo(() => new Date(), []);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(RECORDED_BY_KEY) : null;
    if (saved) setForm((s) => ({ ...s, recordedByName: saved }));
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/warehouse-gatepass")
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load reference data");
        return res.json() as Promise<ReferenceData>;
      })
      .then((data) => {
        if (active) setReference(data);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "Load error");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((s) => ({ ...s, [key]: value }));
    setSuccess(null);
  }

  function setMovementType(movementType: MovementType) {
    setForm((s) => ({
      ...s,
      movementType,
      counterpartyName: "",
      commodityCode: "",
    }));
    setSuccess(null);
  }

  function setCounterparty(name: string) {
    setForm((s) => ({ ...s, counterpartyName: name, commodityCode: "" }));
    setSuccess(null);
  }

  const counterpartyOptions =
    form.movementType === "INBOUND"
      ? reference.inboundCounterparties
      : reference.outboundCounterparties;

  const selectedCounterparty = counterpartyOptions.find((c) => c.name === form.counterpartyName);
  const commodityOptions = selectedCounterparty?.commodities ?? [];
  const selectedCommodity = commodityOptions.find((c) => c.code === form.commodityCode);

  async function submit() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    const payload = {
      movementType: form.movementType,
      counterpartyName: form.counterpartyName,
      brokerName: form.brokerName.trim() || undefined,
      warehouseName: form.warehouseName,
      truckNo: form.truckNo,
      driverName: form.driverName.trim() || undefined,
      driverPhone: form.driverPhone.trim() || undefined,
      builtyDetails: form.builtyDetails.trim(),
      commodityCode: form.commodityCode,
      commodityName: selectedCommodity?.name ?? form.commodityCode,
      recordedByName: form.recordedByName.trim(),
      weightKg: parseFloat(form.weightKg) || 0,
      bags: form.bags ? parseInt(form.bags, 10) : undefined,
      remarks: form.remarks.trim() || undefined,
      gatepassNo: form.gatepassNo.trim() || undefined,
    };
    try {
      const res = await fetch("/api/warehouse-gatepass", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save gatepass");
      localStorage.setItem(RECORDED_BY_KEY, form.recordedByName.trim());
      const at = formatGateTimestamp(new Date());
      setSuccess({ gatepassNo: data.gatepassNo, truckNo: form.truckNo, at });
      setForm((s) => ({
        ...emptyForm,
        movementType: s.movementType,
        warehouseName: s.warehouseName,
        recordedByName: s.recordedByName,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save gatepass");
    } finally {
      setSaving(false);
    }
  }

  const canSubmit =
    Boolean(form.recordedByName.trim()) &&
    Boolean(form.counterpartyName.trim()) &&
    Boolean(form.commodityCode.trim()) &&
    Boolean(form.builtyDetails.trim()) &&
    Boolean(form.warehouseName.trim()) &&
    Boolean(form.truckNo.trim()) &&
    parseFloat(form.weightKg) > 0;

  const accentColor = form.movementType === "INBOUND" ? "#34d399" : "#a78bfa";

  return (
    <main className="min-h-screen bg-[#0b0d11] px-4 py-5 text-white sm:px-6">
      <div className="mx-auto max-w-2xl space-y-5">
        <header className="border-b border-white/10 pb-4">
          <div
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider"
            style={{ color: "#f59e0b" }}
          >
            <ClipboardList className="h-4 w-4" />
            Kastros Supply Chain
          </div>
          <h1 className="mt-2 text-2xl font-bold">Warehouse Gate Register</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Log gate in / gate out trucks. Counterparty and commodity must match live trades.
          </p>
        </header>

        {loading ? (
          <div className="flex h-48 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.02] text-sm text-zinc-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex rounded-2xl border border-white/10 bg-white/[0.03] p-1.5 gap-1.5">
              <ModeButton
                active={form.movementType === "INBOUND"}
                icon={<ArrowDownToLine className="h-4 w-4" />}
                label="Inbound (Gate In)"
                onClick={() => setMovementType("INBOUND")}
                color="#34d399"
              />
              <ModeButton
                active={form.movementType === "OUTBOUND"}
                icon={<ArrowUpFromLine className="h-4 w-4" />}
                label="Outbound (Gate Out)"
                onClick={() => setMovementType("OUTBOUND")}
                color="#a78bfa"
              />
            </div>

            <FormSection title="Register" icon={<User className="h-4 w-4" />} color="#f59e0b">
              <div className="mb-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-xs text-zinc-400">
                <span className="font-medium text-zinc-300">Gate date &amp; time</span> — recorded automatically on
                submit ({formatGateTimestamp(gateTimestamp)})
              </div>
              <Field label="Recorded by" required hint="warehouse manager or staff">
                <input
                  value={form.recordedByName}
                  onChange={(e) => update("recordedByName", e.target.value)}
                  placeholder="Your full name"
                  className={inputClass}
                />
              </Field>
            </FormSection>

            <FormSection
              title="Party & Commodity"
              icon={<ClipboardList className="h-4 w-4" />}
              color={accentColor}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Counterparty" required>
                  <CounterpartySelect
                    value={form.counterpartyName}
                    onChange={setCounterparty}
                    options={counterpartyOptions}
                    placeholder={
                      counterpartyOptions.length === 0
                        ? "No open trades — contact office"
                        : form.movementType === "INBOUND"
                          ? "Select supplier…"
                          : "Select buyer…"
                    }
                    disabled={counterpartyOptions.length === 0}
                  />
                </Field>
                <Field label="Commodity" required>
                  <CommoditySelect
                    value={form.commodityCode}
                    onChange={(code) => update("commodityCode", code)}
                    options={commodityOptions}
                    placeholder={
                      !form.counterpartyName
                        ? "Select counterparty first"
                        : commodityOptions.length === 0
                          ? "No commodities on open trades"
                          : "Select commodity…"
                    }
                    disabled={!form.counterpartyName || commodityOptions.length === 0}
                  />
                </Field>
                <Field label="Broker / Agent" hint="optional">
                  <input
                    value={form.brokerName}
                    onChange={(e) => update("brokerName", e.target.value)}
                    placeholder="Commission agent (if any)"
                    className={inputClass}
                  />
                </Field>
                <Field label="Builty details" required hint="bilty no., route, consignee">
                  <input
                    value={form.builtyDetails}
                    onChange={(e) => update("builtyDetails", e.target.value)}
                    placeholder="e.g. BLT-8821 · Lahore → Karachi"
                    className={inputClass}
                  />
                </Field>
              </div>
            </FormSection>

            <FormSection title="Vehicle" icon={<Truck className="h-4 w-4" />} color={accentColor}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Truck number" required>
                  <input
                    value={form.truckNo}
                    onChange={(e) => update("truckNo", e.target.value.toUpperCase())}
                    placeholder="LEP-4501"
                    className={inputClass}
                  />
                </Field>
                <Field label="Gatepass no." hint="auto if blank">
                  <input
                    value={form.gatepassNo}
                    onChange={(e) => update("gatepassNo", e.target.value)}
                    placeholder="Auto-generated"
                    className={inputClass}
                  />
                </Field>
                <Field label="Driver name" hint="optional">
                  <input
                    value={form.driverName}
                    onChange={(e) => update("driverName", e.target.value)}
                    placeholder="Driver full name"
                    className={inputClass}
                  />
                </Field>
                <Field label="Driver phone" hint="optional">
                  <input
                    value={form.driverPhone}
                    onChange={(e) => update("driverPhone", e.target.value)}
                    placeholder="03xx-xxxxxxx"
                    className={inputClass}
                  />
                </Field>
                <Field label="Remarks" hint="optional" >
                  <input
                    value={form.remarks}
                    onChange={(e) => update("remarks", e.target.value)}
                    placeholder="Seal, condition, route…"
                    className={inputClass}
                  />
                </Field>
              </div>
            </FormSection>

            <FormSection title="Weight & Location" icon={<Warehouse className="h-4 w-4" />} color={accentColor}>
              <p className="mb-3 text-xs text-zinc-500">
                {form.movementType === "INBOUND"
                  ? "Record the gross weight unloaded from the truck at the gate. The execution team assigns this truck to purchase trades — contract received/open quantities are updated when that happens."
                  : "Record the gross weight loaded onto the truck at the gate. The execution team assigns this truck to sale trades — contract fulfilled/open quantities are updated when that happens."}
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-3">
                  <Field label="Warehouse" required>
                    <input
                      list="gatepass-warehouses"
                      value={form.warehouseName}
                      onChange={(e) => update("warehouseName", e.target.value)}
                      placeholder="Select or type warehouse"
                      className={inputClass}
                    />
                    <datalist id="gatepass-warehouses">
                      {reference.warehouses.map((w) => (
                        <option key={w} value={w} />
                      ))}
                    </datalist>
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field
                    label={
                      form.movementType === "INBOUND"
                        ? "Weight unloaded from truck (kg)"
                        : "Weight loaded onto truck (kg)"
                    }
                    required
                  >
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={form.weightKg}
                      onChange={(e) => update("weightKg", e.target.value)}
                      placeholder={
                        form.movementType === "INBOUND"
                          ? "e.g. 21500 — goods offloaded at gate"
                          : "e.g. 21500 — goods loaded for dispatch"
                      }
                      className={inputClass}
                    />
                    <p className="mt-1.5 text-[11px] text-zinc-600">
                      Weighed at gate only. Trade allocation and contract balances are updated after office assignment.
                    </p>
                  </Field>
                </div>
                <Field label="No. of bags" hint="optional">
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={form.bags}
                    onChange={(e) => update("bags", e.target.value)}
                    placeholder="e.g. 420"
                    className={inputClass}
                  />
                </Field>
              </div>
            </FormSection>

            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}
            {success && (
              <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
                <span>
                  Truck <span className="font-mono font-bold">{success.truckNo}</span> logged at{" "}
                  <span className="font-mono">{success.at}</span>. Gatepass:{" "}
                  <span className="font-mono font-bold">{success.gatepassNo}</span>.
                </span>
              </div>
            )}

            <button
              type="button"
              disabled={!canSubmit || saving}
              onClick={submit}
              className="flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-sm font-bold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                background:
                  form.movementType === "INBOUND"
                    ? "linear-gradient(135deg,#34d399,#10b981)"
                    : "linear-gradient(135deg,#a78bfa,#7c3aed)",
                color: "#fff",
              }}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
              {saving
                ? "Saving…"
                : `Log ${form.movementType === "INBOUND" ? "Gate In" : "Gate Out"}`}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

function ModeButton({
  active,
  icon,
  label,
  onClick,
  color,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  color: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all"
      style={{ background: active ? `${color}20` : "transparent", color: active ? color : "#71717a" }}
    >
      {icon}
      {label}
    </button>
  );
}

function FormSection({
  title,
  icon,
  children,
  color,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  color: string;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
        <span style={{ color }}>{icon}</span>
        {title}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
        {label}
        {required && <span className="text-red-400">*</span>}
        {hint && <span className="text-zinc-600">({hint})</span>}
      </label>
      {children}
    </div>
  );
}

function CounterpartySelect({
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (name: string) => void;
  options: GatepassCounterparty[];
  placeholder: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.name === value);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`${inputClass} flex w-full items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50`}
      >
        <span className={`min-w-0 truncate ${selected ? "text-zinc-100" : "text-zinc-500"}`}>
          {selected
            ? `${selected.name} (${selected.code})`
            : placeholder}
        </span>
        <ChevronDown
          className={`h-4 w-4 flex-shrink-0 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && options.length > 0 && (
        <ul
          className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-white/15 bg-[#161a22] py-1 shadow-2xl"
          role="listbox"
        >
          {options.map((cp) => (
            <li key={cp.name} role="option" aria-selected={cp.name === value}>
              <button
                type="button"
                className={`w-full px-3 py-2.5 text-left transition-colors hover:bg-white/10 ${
                  cp.name === value ? "bg-amber-400/10" : ""
                }`}
                onClick={() => {
                  onChange(cp.name);
                  setOpen(false);
                }}
              >
                <div className="text-sm font-medium text-zinc-100">{cp.name}</div>
                <div className="text-xs text-zinc-400">
                  {cp.code} · {cp.openTradeCount} open trade{cp.openTradeCount !== 1 ? "s" : ""}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CommoditySelect({
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (code: string) => void;
  options: GatepassCommodity[];
  placeholder: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.code === value);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`${inputClass} flex w-full items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50`}
      >
        <span className={`min-w-0 truncate ${selected ? "text-zinc-100" : "text-zinc-500"}`}>
          {selected ? `${selected.name} (${selected.code})` : placeholder}
        </span>
        <ChevronDown
          className={`h-4 w-4 flex-shrink-0 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && options.length > 0 && (
        <ul
          className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-white/15 bg-[#161a22] py-1 shadow-2xl"
          role="listbox"
        >
          {options.map((c) => (
            <li key={c.code} role="option" aria-selected={c.code === value}>
              <button
                type="button"
                className={`w-full px-3 py-2.5 text-left text-sm text-zinc-100 transition-colors hover:bg-white/10 ${
                  c.code === value ? "bg-amber-400/10" : ""
                }`}
                onClick={() => {
                  onChange(c.code);
                  setOpen(false);
                }}
              >
                {c.name} <span className="text-zinc-500">({c.code})</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
