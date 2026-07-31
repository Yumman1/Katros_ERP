"use client";

import { useEffect, useState } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { fiscalYearLabel } from "@/lib/finance-policy";
import { trpc } from "@/lib/trpc/client";
import { formatPkDateTime } from "@/lib/formatters/datetime";

const pkrFormat = new Intl.NumberFormat("en-PK");

/** Friendly wording for the head-of-finance-only guard on policy.update. */
function policyErrorMessage(error: { message: string; data?: { code?: string } | null } | null): string | null {
  if (!error) return null;
  if (error.data?.code === "FORBIDDEN") {
    return "Only the head of finance can change policies — ask your department head to make this change.";
  }
  return error.message;
}

export default function FinancePoliciesPage() {
  const utils = trpc.useUtils();
  const { data: policy, isLoading } = trpc.policy.get.useQuery();

  const [limitInput, setLimitInput] = useState("");
  const [limitError, setLimitError] = useState<string | null>(null);
  const [filerRateInput, setFilerRateInput] = useState("");
  const [nonFilerRateInput, setNonFilerRateInput] = useState("");
  const [taxError, setTaxError] = useState<string | null>(null);

  useEffect(() => {
    if (policy) {
      setLimitInput(String(policy.yearlyInflowLimitPkr));
      setFilerRateInput(String(policy.advanceTaxRatePct));
      setNonFilerRateInput(String(policy.advanceTaxRatePctNonFiler));
    }
  }, [policy]);

  const invalidatePolicy = () => {
    void utils.policy.get.invalidate();
    void utils.policy.sellInflowStatus.invalidate();
  };

  const saveLimit = trpc.policy.update.useMutation({ onSuccess: invalidatePolicy });
  const saveTax = trpc.policy.update.useMutation({ onSuccess: invalidatePolicy });

  const submitLimit = () => {
    setLimitError(null);
    const value = Number(limitInput);
    if (!Number.isFinite(value) || value <= 0) {
      setLimitError("Enter a positive PKR amount.");
      return;
    }
    saveLimit.mutate({ yearlyInflowLimitPkr: value });
  };

  const submitTax = () => {
    setTaxError(null);
    const filer = Number(filerRateInput);
    const nonFiler = Number(nonFilerRateInput);
    if (!Number.isFinite(filer) || filer < 0 || filer > 100) {
      setTaxError("Enter an ATL filer rate between 0 and 100.");
      return;
    }
    if (!Number.isFinite(nonFiler) || nonFiler < 0 || nonFiler > 100) {
      setTaxError("Enter a non-filer rate between 0 and 100.");
      return;
    }
    saveTax.mutate({ advanceTaxRatePct: filer, advanceTaxRatePctNonFiler: nonFiler });
  };

  return (
    <div className="kastros-desk-page">
      <PageHeader
        title="Policies"
        subtitle="Company-wide finance knobs — changes apply everywhere in the software immediately."
      />

      <div className="kastros-desk-scroll space-y-4 pb-6">
        {isLoading ? (
          <div className="py-12 text-center text-sm text-subtle">Loading policies…</div>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <section className="exec-panel">
                <h2 className="text-sm font-semibold text-foreground">Yearly counterparty inflow limit</h2>
                <div className="mt-2 text-2xl font-bold tabular-nums text-foreground">
                  {policy ? `${pkrFormat.format(policy.yearlyInflowLimitPkr)} PKR` : "—"}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Maximum money actually received (finance-approved vouchers) per buyer per fiscal year
                  (1 July – 30 June, currently {fiscalYearLabel()}). Buyers whose received tally is over the
                  limit get a caution tag in the booking form.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    value={limitInput}
                    onChange={(e) => setLimitInput(e.target.value)}
                    placeholder="Limit in PKR"
                    className="kastros-input w-56"
                  />
                  <button
                    type="button"
                    disabled={saveLimit.isPending}
                    onClick={submitLimit}
                    className="kastros-btn-primary text-xs disabled:opacity-50"
                  >
                    {saveLimit.isPending ? "Saving…" : "Save"}
                  </button>
                </div>
                {(limitError || saveLimit.error) && (
                  <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                    {limitError ?? policyErrorMessage(saveLimit.error)}
                  </p>
                )}
                <p className="mt-2 text-[11px] text-subtle">Only the head of finance can change policies.</p>
              </section>

              <section className="exec-panel">
                <h2 className="text-sm font-semibold text-foreground">Advance income tax 236G</h2>
                <div className="mt-2 flex flex-wrap gap-x-8 gap-y-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-subtle">ATL filer</div>
                    <div className="text-2xl font-bold tabular-nums text-foreground">
                      {policy ? `${policy.advanceTaxRatePct}%` : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-subtle">Non-filer</div>
                    <div className="text-2xl font-bold tabular-nums text-foreground">
                      {policy ? `${policy.advanceTaxRatePctNonFiler}%` : "—"}
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Applied on price × quantity of every sale. The booking form automatically picks the rate from
                  the buyer&apos;s ATL filer status — filers get the filer rate, non-filers the non-filer rate.
                </p>
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-subtle">
                      ATL filer rate (%)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.01}
                      value={filerRateInput}
                      onChange={(e) => setFilerRateInput(e.target.value)}
                      placeholder="Filer rate %"
                      className="kastros-input w-36"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-subtle">
                      Non-filer rate (%)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.01}
                      value={nonFilerRateInput}
                      onChange={(e) => setNonFilerRateInput(e.target.value)}
                      placeholder="Non-filer rate %"
                      className="kastros-input w-36"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={saveTax.isPending}
                    onClick={submitTax}
                    className="kastros-btn-primary text-xs disabled:opacity-50"
                  >
                    {saveTax.isPending ? "Saving…" : "Save"}
                  </button>
                </div>
                {(taxError || saveTax.error) && (
                  <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                    {taxError ?? policyErrorMessage(saveTax.error)}
                  </p>
                )}
                <p className="mt-2 text-[11px] text-subtle">Only the head of finance can change policies.</p>
              </section>
            </div>

            <p className="text-xs text-subtle">
              {policy?.updatedAt
                ? `Last updated ${formatPkDateTime(policy.updatedAt)}${
                    policy.updatedBy ? ` by ${policy.updatedBy}` : ""
                  }`
                : "Not customized yet — running on company defaults."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
