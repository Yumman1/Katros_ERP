"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { PageHeader } from "@/components/ui/page-header";
import { fiscalYearLabel } from "@/lib/finance-policy";
import { trpc } from "@/lib/trpc/client";

const pkrFormat = new Intl.NumberFormat("en-PK");

export default function FinancePoliciesPage() {
  const utils = trpc.useUtils();
  const { data: policy, isLoading } = trpc.policy.get.useQuery();

  const [limitInput, setLimitInput] = useState("");
  const [limitError, setLimitError] = useState<string | null>(null);
  const [taxInput, setTaxInput] = useState("");
  const [taxError, setTaxError] = useState<string | null>(null);

  useEffect(() => {
    if (policy) {
      setLimitInput(String(policy.yearlyInflowLimitPkr));
      setTaxInput(String(policy.advanceTaxRatePct));
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
    const value = Number(taxInput);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      setTaxError("Enter a rate between 0 and 100.");
      return;
    }
    saveTax.mutate({ advanceTaxRatePct: value });
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
                  Maximum sale value per buyer per fiscal year (1 July – 30 June, currently {fiscalYearLabel()}).
                  Buyers over the limit get a caution tag in the booking form.
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
                  <p className="mt-2 text-xs text-destructive">{limitError ?? saveLimit.error?.message}</p>
                )}
              </section>

              <section className="exec-panel">
                <h2 className="text-sm font-semibold text-foreground">Advance income tax 236G</h2>
                <div className="mt-2 text-2xl font-bold tabular-nums text-foreground">
                  {policy ? `${policy.advanceTaxRatePct}%` : "—"}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Applied on price × quantity of every sale. Shown read-only on booking and trade pages; changing it
                  here updates the whole app.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    value={taxInput}
                    onChange={(e) => setTaxInput(e.target.value)}
                    placeholder="Rate %"
                    className="kastros-input w-56"
                  />
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
                  <p className="mt-2 text-xs text-destructive">{taxError ?? saveTax.error?.message}</p>
                )}
              </section>
            </div>

            <p className="text-xs text-subtle">
              {policy?.updatedAt
                ? `Last updated ${format(new Date(policy.updatedAt), "d MMM yyyy, HH:mm")}${
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
