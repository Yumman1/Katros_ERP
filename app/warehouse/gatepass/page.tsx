"use client";
import {SesameExportContainers} from "@/components/warehouse/sesame-export-containers";
import {usesSesameWorkflow} from "@/lib/sesame";
import { warehouseAllowedForCommodity } from "@/lib/warehouse-eligibility";

import { ThemeToggle } from "@/components/theme/theme-toggle";

import {
  GatepassCommoditySelect as CommoditySelect,
  GatepassCounterpartySelect as CounterpartySelect,
  GatepassField as Field,
  GatepassFormSection as FormSection,
  GatepassModeButton as ModeButton,
  gatepassInputClass as inputClass,
  type GatepassCounterparty,
} from "@/components/warehouse/gatepass-form-fields";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowRightLeft,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Truck,
  User,
  Warehouse,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatPkDateTime } from "@/lib/formatters/datetime";

const RECORDED_BY_KEY = "kastros-gatepass-recorded-by";

type ReferenceData = {
  exportTrades?: {tradeRef:string;counterpartyName:string;commodityCode:string;commodityName:string;entity:string}[];
  /** FZCO buyers with an open international sale — the counterparty of a triparty gate-out. */
  tripartyCounterparties?: GatepassCounterparty[];
  tripartyInternalTrades?: {tradeRef:string;commodityCode:string;openMt:number}[];
  advances?: { id: string; tradeRef: string; builtyNumber: string; truckNo: string | null; counterpartyName: string; commodityCode: string; transporterName: string; advanceWeightKg: number }[];
  warehouses: string[];
  inboundCounterparties: (GatepassCounterparty & {trades?: {tradeRef:string;commodityCode:string;profile:string}[]})[];
  outboundCounterparties: GatepassCounterparty[];
  nextGatepassNo?: string;
};

type MovementType = "INBOUND" | "OUTBOUND";

const emptyForm = {
  advanceVoucherId: "",
  advanceTradeRef: "",
  purchaseTradeRef:"",
  movementType: "INBOUND" as MovementType,
  recordedByName: "",
  counterpartyName: "",
  commodityCode: "",
  builtyDetails: "",
  warehouseName: "",
  truckNo: "",
  transporterName: "",
  transporterPhone: "",
  quantityAsPerBuilty: "",
  weightAsPerBuiltyKg: "",
  weighBridgeName: "",
  warehouseWeightKg: "",
  quantityBagsBales: "",
  totalDeductionsKg: "",
  remarks: "",
};

function formatGateTimestamp(d: Date) {
  return formatPkDateTime(d);
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function integerString(value: string) {
  return value.replace(/[^\d]/g, "");
}

export default function WarehouseGatepassPage() {
  const [reference, setReference] = useState<ReferenceData>({
    warehouses: [],
    inboundCounterparties: [],
    outboundCounterparties: [],
  });
  const [outboundScope,setOutboundScope]=useState<'LOCAL'|'INTERNATIONAL'>('LOCAL');
  // Triparty (Gate Out): Pakistan → Dubai FZCO internal sale shipped straight to FZCO's buyer.
  const [triparty,setTriparty]=useState(false);
  const [purchaseBasis,setPurchaseBasis]=useState<'PURCHASE_DELIVERED'|'PURCHASE_SPOT'>('PURCHASE_DELIVERED');
  const [form, setForm] = useState(emptyForm);
  const [documents, setDocuments] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ gatepassNo: string; truckNo: string; at: string } | null>(
    null,
  );
  const [previewTick, setPreviewTick] = useState(0);
  const gateTimestamp = useMemo(() => new Date(), []);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(RECORDED_BY_KEY) : null;
    if (saved) setForm((s) => ({ ...s, recordedByName: saved }));
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = new URLSearchParams();
    if (form.warehouseName.trim()) params.set("warehouse", form.warehouseName.trim());
    params.set("movementType", form.movementType);
    fetch(`/api/warehouse-gatepass?${params.toString()}`)
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
  }, [form.warehouseName, form.movementType, previewTick]);

  // Initial warehouse list (no warehouse filter yet)
  useEffect(() => {
    let active = true;
    fetch("/api/warehouse-gatepass")
      .then(async (res) => res.json() as Promise<ReferenceData>)
      .then((data) => {
        if (active) {
          setReference((prev) => ({
            ...prev,
            warehouses: data.warehouses.length ? data.warehouses : prev.warehouses,
          }));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((s) => ({ ...s, [key]: value, ...(key === "commodityCode" ? {advanceVoucherId:""}: {}) }));
    setSuccess(null);
  }

  function setMovementType(movementType: MovementType, tripartyMode = false) {
    setTriparty(tripartyMode);
    if (tripartyMode) setOutboundScope("INTERNATIONAL");
    setForm((s) => ({
      ...s,
      movementType,
      counterpartyName: "",
      commodityCode: "",
      advanceVoucherId: "",
    }));
    setSuccess(null);
  }

  function setWarehouse(name: string) {
    setForm((s) => ({
      ...s,
      warehouseName: name,
      counterpartyName: "",
      commodityCode: "",
      advanceVoucherId: "",
    }));
    setSuccess(null);
  }

  function setCounterparty(name: string) {
    setForm((s) => ({ ...s, counterpartyName: name, commodityCode: "", advanceVoucherId: "" }));
    setSuccess(null);
  }

  const counterpartyOptions =
    triparty
      ? reference.tripartyCounterparties ?? []
      : form.movementType === "INBOUND"
        ? reference.inboundCounterparties
        : reference.outboundCounterparties;

  const alternateCounterpartyOptions =
    form.movementType === "INBOUND"
      ? reference.outboundCounterparties
      : reference.inboundCounterparties;

  const counterpartyEmptyHint =
    triparty
      ? form.warehouseName.trim() && counterpartyOptions.length === 0
        ? (reference.tripartyInternalTrades?.length ? "No Dubai FZCO buyer has an open international sale yet. Book and lock the FZCO sale first." : "No open Pakistan → Dubai FZCO internal sale is allocated to this warehouse.")
        : null
      : form.warehouseName.trim() && counterpartyOptions.length === 0
      ? alternateCounterpartyOptions.length > 0
        ? form.movementType === "INBOUND"
          ? `Only open sale (ex-warehouse) trades exist at this warehouse — use Gate Out for buyers such as ${alternateCounterpartyOptions.map((c) => c.name).join(", ")}.`
          : `Only open purchase trades exist at this warehouse — use Gate In for suppliers such as ${alternateCounterpartyOptions.map((c) => c.name).join(", ")}.`
        : "No open locked trades are allocated to this warehouse for gatepass."
      : null;

  const selectedCounterparty = counterpartyOptions.find((c) => c.name === form.counterpartyName);
  const commodityOptions = selectedCounterparty?.commodities ?? [];
  const selectedCommodity = commodityOptions.find((c) => c.code === form.commodityCode);

  async function submit() {
    if(exportMode)return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    const payload = {
      movementType: form.movementType,
      counterpartyName: form.counterpartyName,
      warehouseName: form.warehouseName,
      truckNo: form.truckNo,
      advanceVoucherId: form.advanceVoucherId || undefined,

      purchaseBasis,
      transporterName: form.transporterName.trim() || undefined,
      transporterPhone: form.transporterPhone.trim() || undefined,
      builtyDetails: form.builtyDetails.trim(),
      commodityCode: form.commodityCode,
      commodityName: selectedCommodity?.name ?? form.commodityCode,
      recordedByName: form.recordedByName.trim(),
      quantityAsPerBuilty:
        form.movementType === "INBOUND" && form.quantityBagsBales.trim()
          ? `${form.quantityBagsBales.trim()} bags`
          : form.quantityAsPerBuilty.trim() || undefined,
      weightAsPerBuiltyKg: parseFloat(form.weightAsPerBuiltyKg) || 0,
      weighBridgeName: form.weighBridgeName.trim() || undefined,
      warehouseWeightKg:
        form.movementType === "INBOUND" && form.warehouseWeightKg.trim()
          ? parseFloat(form.warehouseWeightKg)
          : undefined,

      quantityBagsBales:
        form.movementType === "INBOUND" && form.quantityBagsBales.trim()
          ? parseInt(form.quantityBagsBales, 10)
          : undefined,

      remarks: form.remarks.trim() || undefined,
    };
    try {
      let res: Response;
      if (documents.length > 0) {
        const body = new FormData();
        body.append("payload", JSON.stringify(payload));
        for (const file of documents) body.append("documents", file);
        res = await fetch("/api/warehouse-gatepass", { method: "POST", body });
      } else {
        res = await fetch("/api/warehouse-gatepass", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save gatepass");
      localStorage.setItem(RECORDED_BY_KEY, form.recordedByName.trim());
      const at = formatGateTimestamp(new Date());
      setSuccess({
        gatepassNo: data.gatepassNo,
        truckNo: form.truckNo,
        at,
      });
      setPreviewTick((t) => t + 1);
      setDocuments([]);
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

  const exportMode=form.movementType==='OUTBOUND'&&usesSesameWorkflow(form.commodityCode)&&(outboundScope==='INTERNATIONAL'||triparty);
  const paidAdvance=reference.advances?.find(v=>v.id===form.advanceVoucherId);
  const purchaseTrade=reference.inboundCounterparties.find(c=>c.name===form.counterpartyName)?.trades?.find(t=>t.tradeRef===paidAdvance?.tradeRef);
  const delivered=form.movementType==='INBOUND'&&(purchaseTrade?.profile??purchaseBasis)==='PURCHASE_DELIVERED';
  const missing=[!form.recordedByName.trim()&&'Enter your name',!form.warehouseName.trim()&&'Select warehouse',!form.counterpartyName.trim()&&'Select counterparty',!form.commodityCode.trim()&&'Select commodity',!form.truckNo.trim()&&'Enter truck number',!/^\d+$/.test(form.builtyDetails.trim())&&'Enter a numeric builty number',(!(Number(delivered?form.warehouseWeightKg:form.weightAsPerBuiltyKg)>0)||!Number.isFinite(Number(delivered?form.warehouseWeightKg:form.weightAsPerBuiltyKg)))&&(delivered?'Enter warehouse weight after offloading':form.movementType==='OUTBOUND'?'Enter Container / Truck Weight':'Enter weight as per seller')].filter(Boolean);
  const canSubmit=!exportMode&&missing.length===0;

  const accentColor = form.movementType === "INBOUND" ? "#34d399" : triparty ? "#f59e0b" : "#a78bfa";

  return (
    <main className="bg-background px-4 py-5 pb-8 text-foreground sm:px-6">
      <div className="mx-auto max-w-2xl 2xl:max-w-none space-y-5">
        <div className="flex justify-end">
          <ThemeToggle />
        </div>
        <header className="border-b border-border pb-4">
          <div
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider"
            style={{ color: "#f59e0b" }}
          >
            <ClipboardList className="h-4 w-4" />
            Kastros Supply Chain
          </div>
          <h1 className="mt-2 text-2xl font-bold">Warehouse Gate Register</h1>
          <p className="mt-1 text-sm text-subtle">
            Select warehouse first — counterparties with open trades at that warehouse (including
            spot purchase suppliers) appear.
          </p>
        </header>

        {loading ? (
          <div className="flex h-48 items-center justify-center rounded-2xl border border-border bg-foreground/[0.02] text-sm text-subtle">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex rounded-2xl border border-border bg-foreground/[0.03] p-1.5 gap-1.5">
              <ModeButton
                active={form.movementType === "INBOUND"}
                icon={<ArrowDownToLine className="h-4 w-4" />}
                label="Inbound (Gate In)"
                onClick={() => setMovementType("INBOUND")}
                color="#34d399"
              />
              <ModeButton
                active={form.movementType === "OUTBOUND" && !triparty}
                icon={<ArrowUpFromLine className="h-4 w-4" />}
                label="Outbound (Gate Out)"
                onClick={() => setMovementType("OUTBOUND")}
                color="#a78bfa"
              />
              <ModeButton
                active={triparty}
                icon={<ArrowRightLeft className="h-4 w-4" />}
                label="Triparty (Gate Out)"
                onClick={() => setMovementType("OUTBOUND", true)}
                color="#f59e0b"
              />
            </div>
            {triparty && <p className="text-xs text-subtle">Pakistan sells to Dubai FZCO and the containers ship straight to FZCO&apos;s buyer. Select the final buyer; execution assigns the internal sale and the FZCO sale.</p>}

            <FormSection title="Register" icon={<User className="h-4 w-4" />} color="#f59e0b">
              <div className="mb-3 rounded-xl border border-border bg-foreground/[0.03] px-3 py-2.5 text-xs text-muted-foreground">
                <span className="font-medium text-muted-foreground">Gate date &amp; time</span> — recorded automatically on
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

            <FormSection title="Warehouse" icon={<Warehouse className="h-4 w-4" />} color={accentColor}>
              <Field label="Warehouse" required hint="choose before counterparty">
                <input
                  list="gatepass-warehouses"
                  value={form.warehouseName}
                  onChange={(e) => setWarehouse(e.target.value)}
                  placeholder="Select warehouse…"
                  className={inputClass}
                />
                <datalist id="gatepass-warehouses">
                  {reference.warehouses.filter(w=>warehouseAllowedForCommodity(w,form.commodityCode)).filter((w) => w.toLocaleLowerCase().startsWith(form.warehouseName.trim().toLocaleLowerCase())).map((w) => (
                    <option key={w} value={w} />
                  ))}
                </datalist>
              </Field>
            </FormSection>

            <FormSection
              title="Party & Commodity"
              icon={<ClipboardList className="h-4 w-4" />}
              color={accentColor}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={triparty ? "Final buyer (Dubai FZCO sale)" : "Counterparty"} required>
                  <CounterpartySelect
                    value={form.counterpartyName}
                    onChange={setCounterparty}
                    options={counterpartyOptions}
                    placeholder={
                      !form.warehouseName.trim()
                        ? "Select warehouse first"
                        : counterpartyOptions.length === 0
                          ? triparty
                            ? "No FZCO buyer sales available"
                            : form.movementType === "INBOUND"
                            ? "No purchase trades for Gate In"
                            : "No sale trades for Gate Out"
                          : form.movementType === "INBOUND"
                            ? "Select supplier…"
                            : "Select buyer…"
                    }
                    disabled={!form.warehouseName.trim() || counterpartyOptions.length === 0}
                  />
                  {counterpartyEmptyHint ? (
                    <div className="mt-2 space-y-2">
                      <p className="text-xs text-amber-600 dark:text-amber-400">{counterpartyEmptyHint}</p>
                      {!triparty && alternateCounterpartyOptions.length > 0 ? (
                        <button
                          type="button"
                          onClick={() =>
                            setMovementType(form.movementType === "INBOUND" ? "OUTBOUND" : "INBOUND")
                          }
                          className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                        >
                          Switch to {form.movementType === "INBOUND" ? "Gate Out" : "Gate In"}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
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
              </div>
            </FormSection>

            {form.movementType === "INBOUND" && <FormSection title="Purchase details" icon={<ClipboardList className="h-4 w-4" />} color={accentColor}>
              <Field label="Purchase basis"><select className={inputClass} value={purchaseTrade?.profile??purchaseBasis} disabled={!!purchaseTrade} onChange={e=>setPurchaseBasis(e.target.value as typeof purchaseBasis)}><option value="PURCHASE_DELIVERED">Delivered</option><option value="PURCHASE_SPOT">Ex-Works</option></select></Field>
              <Field label="Approved advance builty (if paid)"><select className={inputClass} value={form.advanceVoucherId} onChange={e=>{const v=reference.advances?.find(a=>a.id===e.target.value);setForm(f=>({...f,advanceVoucherId:v?.id??'',truckNo:v?.truckNo??f.truckNo,builtyDetails:v?.builtyNumber??f.builtyDetails,transporterName:v?.transporterName??f.transporterName,weightAsPerBuiltyKg:v?String(v.advanceWeightKg):f.weightAsPerBuiltyKg}));}}><option value="">No advance selected</option>{reference.advances?.filter(v=>v.counterpartyName===form.counterpartyName&&v.commodityCode===form.commodityCode).map(v=><option key={v.id} value={v.id}>{v.builtyNumber} · Truck {v.truckNo??'—'}</option>)}</select></Field>
            </FormSection>}
            {form.movementType==='OUTBOUND'&&!triparty&&usesSesameWorkflow(form.commodityCode)&&<div className="exec-segment">{(['LOCAL','INTERNATIONAL'] as const).map(scope=><button key={scope} type="button" aria-pressed={outboundScope===scope} className={`exec-segment-item ${outboundScope===scope?'exec-segment-active':''}`} onClick={()=>setOutboundScope(scope)}>{scope==='LOCAL'?'Local':'International'}</button>)}</div>}
            {exportMode?<SesameExportContainers key={[form.counterpartyName,form.commodityCode,form.warehouseName,String(triparty)].join(':')} triparty={triparty} counterpartyName={form.counterpartyName} commodityCode={form.commodityCode} warehouseName={form.warehouseName} recordedByName={form.recordedByName} onSaved={()=>setPreviewTick(v=>v+1)}/>:<>
            <FormSection title={form.movementType === "OUTBOUND" ? "Outbound details" : "Inbound details"} icon={<Truck className="h-4 w-4" />} color={accentColor}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Truck number" required>
                  <input
                    value={form.truckNo}
                    onChange={(e) => update("truckNo", e.target.value.toUpperCase())}
                    placeholder="LEP-4501"
                    className={inputClass}
                  />
                </Field>
                <Field label="Gatepass no.">
                  <div className="rounded-xl border border-border bg-foreground/[0.03] px-3 py-2.5">
                    <span className="font-mono text-sm font-semibold text-foreground">
                      {reference.nextGatepassNo ?? "…"}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-subtle">Auto-generated when you submit this entry.</p>
                </Field>
                <Field label="Transporter name">
                  <input
                    value={form.transporterName}
                    onChange={(e) => update("transporterName", e.target.value)}
                    placeholder="Transport company or agent"
                    className={inputClass}
                  />
                </Field>
                <Field label="Transporter number">
                  <input
                    value={form.transporterPhone}
                    onChange={(e) => update("transporterPhone", e.target.value)}
                    placeholder="03xx-xxxxxxx"
                    className={inputClass}
                  />
                </Field>
                <Field label="Remarks" hint="optional">
                  <input
                    value={form.remarks}
                    onChange={(e) => update("remarks", e.target.value)}
                    placeholder="Seal, condition, route…"
                    className={inputClass}
                  />
                </Field>
                <Field label="Builty number" required>
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={form.builtyDetails}
                    onChange={(e) => update("builtyDetails", digitsOnly(e.target.value))}
                    placeholder="e.g. 8821"
                    className={inputClass}
                  />
                </Field>
                <Field label={form.movementType === "OUTBOUND" && usesSesameWorkflow(form.commodityCode) ? "Container / Truck Weight (kg)" : "Weight as per seller (Kg)"} required={!delivered}>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="1"
                    min="0"
                    value={form.weightAsPerBuiltyKg}
                    onChange={(e) => update("weightAsPerBuiltyKg", e.target.value)}
                    placeholder="e.g. 21500"
                    className={inputClass}
                  />
                </Field>
                <Field label="Weigh bridge name">
                  <input
                    value={form.weighBridgeName}
                    onChange={(e) => update("weighBridgeName", e.target.value)}
                    placeholder="e.g. Main gate weighbridge"
                    className={inputClass}
                  />
                </Field>
                {form.movementType === "INBOUND" && <>
                  <Field label="Warehouse weight (kg)" required={delivered} hint="after offload / warehouse weighment">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="1"
                      min="0"
                      value={form.warehouseWeightKg}
                      onChange={(e) => update("warehouseWeightKg", e.target.value)}
                      placeholder="e.g. 21200"
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Number of bags">
                    <input
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={form.quantityBagsBales}
                      onChange={(e) => update("quantityBagsBales", integerString(e.target.value))}
                      placeholder="e.g. 420"
                      className={inputClass}
                    />
                  </Field>

                </>}
              </div>
            </FormSection>

            <FormSection title="Documents" icon={<Upload className="h-4 w-4" />} color={accentColor}>
              <Field label="Upload documents for gate pass" hint="builty, weigh slip, photos">
                <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border bg-foreground/[0.03] px-3 py-2.5 text-xs text-muted-foreground hover:bg-foreground/[0.06]">
                  <Upload className="h-4 w-4 flex-shrink-0" />
                  <span className="truncate">
                    {documents.length
                      ? `${documents.length} file${documents.length !== 1 ? "s" : ""} selected`
                      : "Choose files…"}
                  </span>
                  <input
                    type="file"
                    multiple
                    accept="image/*,.pdf,.doc,.docx"
                    className="sr-only"
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      setDocuments(files);
                      setSuccess(null);
                    }}
                  />
                </label>
                {documents.length > 0 && (
                  <ul className="mt-2 space-y-1 text-[11px] text-subtle">
                    {documents.map((f) => (
                      <li key={`${f.name}-${f.size}`} className="truncate">
                        {f.name}
                      </li>
                    ))}
                  </ul>
                )}
              </Field>
            </FormSection>
            </>}

            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}
            {success && (
              <div className="space-y-2">
                <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                  <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
                  <span>
                    Truck <span className="font-mono font-bold">{success.truckNo}</span> logged at{" "}
                    <span className="font-mono">{success.at}</span>. Gatepass:{" "}
                    <span className="font-mono font-bold">{success.gatepassNo}</span>.
                  </span>
                </div>
                <p className="rounded-xl border border-border bg-foreground/[0.03] px-4 py-3 text-xs text-muted-foreground">
                  Truck is queued for execution. Assign it to a trade on{" "}
                  <strong className="text-muted-foreground">Execution → Truck Movements</strong>.
                </p>
              </div>
            )}

            {!exportMode&&missing.length>0&&<div role="status" className="text-sm text-destructive"><p>Complete these fields to submit:</p><ul className="list-disc pl-5">{missing.map((m,i)=><li key={i}>{m}</li>)}</ul></div>}
            {!exportMode&&<button
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
            </button>}
          </div>
        )}
      </div>
    </main>
  );
}
