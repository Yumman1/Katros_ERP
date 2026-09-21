"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { trpc } from "@/lib/trpc/client";
import { updateCounterpartyProfileSchema } from "@/lib/counterparty-profile";
import type { MockCounterpartyOption } from "@/server/trader-master-data";

function formValues(cp: MockCounterpartyOption) {
  return {
    type: cp.type, country: cp.country,
    contactPerson: cp.contactPerson ?? "", contactPhone: cp.contactPhone ?? "",
    companyNameNtn: cp.companyNameNtn ?? "", ntn: cp.ntn ?? "",
    address: cp.address ?? "", bankDetails: cp.bankDetails ?? "",
    taxFilerStatus: cp.taxFilerStatus, kycStatus: cp.kycStatus, kycRef: cp.kycRef ?? "",
    kycExpires: cp.kycExpires ? new Date(cp.kycExpires).toISOString().slice(0, 10) : "",
    creditLimit: cp.creditLimit == null ? "" : String(cp.creditLimit),
  };
}

type FormValues = ReturnType<typeof formValues>;
const textFields = [
  { key: "contactPerson", label: "Contact person", max: 200 },
  { key: "contactPhone", label: "Contact number", max: 50, type: "tel" },
  { key: "companyNameNtn", label: "Legal company name (NTN)", max: 250 },
  { key: "ntn", label: "NTN", max: 100 },
  { key: "country", label: "Country", max: 100 },
  { key: "kycRef", label: "KYC reference", max: 250 },
] as const;

export function CounterpartyProfileEditor({ counterparty, onClose, onSaved }: {
  counterparty: MockCounterpartyOption;
  onClose: () => void;
  onSaved: (cp: MockCounterpartyOption) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [initial] = useState(() => formValues(counterparty));
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const update = trpc.trader.updateCounterpartyProfile.useMutation({
    onSuccess: (cp) => {
      // Invalidate all mounted views: profile fields appear on trades, prints,
      // ledgers and contracts; stale data must not survive a successful save.
      void utils.invalidate();
      onSaved(cp);
    },
    onError: (failure) => setError(failure.message),
  });
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);

  function change(key: keyof FormValues, value: string) {
    setValues((previous) => ({ ...previous, [key]: value }));
    setError(null);
  }

  const dirty = (Object.keys(initial) as (keyof FormValues)[]).some((key) => values[key] !== initial[key]);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (update.isPending) return;
    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(initial) as (keyof FormValues)[]) {
      if (values[key] === initial[key]) continue;
      const value = values[key].trim();
      patch[key] = key === "creditLimit" ? (value ? Number(value) : null)
        : key === "kycExpires" ? (value || null) : value;
    }
    const parsed = updateCounterpartyProfileSchema.safeParse({ id: counterparty.id, patch });
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => `${issue.path.slice(1).join(".") || "Profile"}: ${issue.message}`).join(". "));
      return;
    }
    setError(null);
    update.mutate(parsed.data);
  }

  return (
    <dialog ref={dialog} aria-labelledby="counterparty-editor-title"
      onCancel={(event) => { event.preventDefault(); if (!update.isPending) onClose(); }}
      className="m-auto w-[calc(100%_-_2rem)] max-w-2xl max-h-[90dvh] overflow-y-auto rounded-xl border border-kastros-border bg-kastros-card p-5 text-foreground shadow-xl backdrop:bg-black/60">
      <form onSubmit={submit} className="space-y-4">
        <h2 id="counterparty-editor-title" className="text-lg font-semibold">Edit counterparty</h2>
        <p className="text-xs text-subtle">Update shared profile information. The counterparty name and code are fixed.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs text-muted-foreground">Counterparty name
            <input aria-label="Counterparty name" value={counterparty.name} disabled
              className="kastros-input mt-1 w-full cursor-not-allowed bg-foreground/10 text-subtle opacity-60" />
          </label>
          <label className="text-xs text-muted-foreground">Counterparty code
            <input value={counterparty.code} disabled className="kastros-input mt-1 w-full cursor-not-allowed bg-foreground/10 text-subtle opacity-60" />
          </label>
        </div>
        <fieldset disabled={update.isPending} className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs text-muted-foreground">Type
            <select value={values.type} onChange={(event) => change("type", event.target.value)} className="kastros-select mt-1 w-full">
              {["TRADING_PARTNER", "BUYER", "SELLER", "BROKER", "BANK"].map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">Tax filer status
            <select value={values.taxFilerStatus} onChange={(event) => change("taxFilerStatus", event.target.value)} className="kastros-select mt-1 w-full">
              <option value="FILER">Filer</option><option value="NON_FILER">Non-filer</option>
            </select>
          </label>
          {textFields.map((field) => <label key={field.key} className="text-xs text-muted-foreground">{field.label}
            <input value={values[field.key]} type={"type" in field ? field.type : "text"} maxLength={field.max} required={field.key === "country"}
              onChange={(event) => change(field.key, event.target.value)} className="kastros-input mt-1 w-full" />
          </label>)}
          <label className="text-xs text-muted-foreground">KYC status
            <select value={values.kycStatus} onChange={(event) => change("kycStatus", event.target.value)} className="kastros-select mt-1 w-full">
              {["VERIFIED", "PENDING", "EXPIRED", "NOT_ON_FILE"].map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">KYC expiry
            <input type="date" value={values.kycExpires} onChange={(event) => change("kycExpires", event.target.value)} className="kastros-input mt-1 w-full" />
          </label>
          <label className="text-xs text-muted-foreground">Credit limit
            <input type="number" min="0" max="999999999999" step="0.0001" value={values.creditLimit}
              onChange={(event) => change("creditLimit", event.target.value)} className="kastros-input mt-1 w-full" />
          </label>
          {([ ["address", "Address"], ["bankDetails", "Bank details"] ] as const).map(([key, label]) => (
            <label key={key} className="text-xs text-muted-foreground sm:col-span-2">{label}
              <textarea rows={3} maxLength={2000} value={values[key]} onChange={(event) => change(key, event.target.value)} className="kastros-input mt-1 w-full" />
            </label>
          ))}
        </fieldset>
        <p className="text-xs text-subtle">These details are shared across this counterparty&apos;s trades. Tax status changes apply wherever the current profile is used; saved trade prices and posted balances are preserved.</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={update.isPending} onClick={onClose} className="kastros-btn-secondary">Cancel</button>
          <button type="submit" disabled={update.isPending || !dirty} className="kastros-btn-primary disabled:opacity-50">{update.isPending ? "Saving…" : "Save changes"}</button>
        </div>
      </form>
    </dialog>
  );
}
