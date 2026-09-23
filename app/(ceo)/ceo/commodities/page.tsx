"use client";

import { useRecordFilters } from "@/components/ui/record-filters";


import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import { CommodityRegistrationFields } from "@/components/trader/commodity-registration-fields";
import { PageHeader } from "@/components/ui/page-header";
import {
  buildCommodityCreatePayload,
  emptyCommodityFormState,
} from "@/lib/commodity-registration";
import { trpc } from "@/lib/trpc/client";
import type { TradeParamDefinition } from "@/lib/trade-parameters";

export default function CeoCommoditiesPage() {
  const utils = trpc.useUtils();
  const refData = trpc.trader.referenceData.useQuery();
  const [form, setForm] = useState(emptyCommodityFormState);
  const [tradeParams, setTradeParams] = useState<TradeParamDefinition[]>([]);
  const [success, setSuccess] = useState<string | null>(null);

  const addCommodity = trpc.ceo.addCommodity.useMutation({
    onSuccess: (row) => {
      setSuccess(`${row.code} — ${row.name} is now available to all traders.`);
      setForm(emptyCommodityFormState());
      setTradeParams([]);
      void utils.trader.referenceData.invalidate();
      void utils.ceo.commodities.invalidate();
      void utils.ceo.traderCommodities.invalidate();
      void utils.ceo.users.invalidate();
    },
  });

  const commodities = trpc.ceo.commodities.useQuery();

  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteCommodity = trpc.ceo.deleteCommodity.useMutation({
    onSuccess: (row) => {
      setDeleteError(null);
      setSuccess(`${row.code} — ${row.name} was removed from the registry.`);
      void utils.trader.referenceData.invalidate();
      void utils.ceo.commodities.invalidate();
      void utils.ceo.traderCommodities.invalidate();
      void utils.ceo.users.invalidate();
    },
    onError: (e) => setDeleteError(e.message),
  });

  const listFilters = useRecordFilters("commodities", commodities.data, { searchPaths: ["name", "code"] });
  const quantityUnitOptions = refData.data?.quantityUnits ?? ["MT", "BAG", "MAUND_40"];

  return (
    <div className="kastros-desk-page mx-auto max-w-3xl">
      <PageHeader
        title="Commodity registry"
        subtitle="Register commodities directly — they appear in every trader's dropdown once saved."
      />

      <div className="kastros-desk-scroll space-y-5 pb-6">
      <Link href="/ceo/trader-commodities" className="inline-block text-sm text-brand underline">Manage trader commodity assignments</Link>
      <section className="rounded-xl border border-kastros-border bg-kastros-card p-5">
        <h2 className="text-sm font-semibold text-foreground">Register new commodity</h2>
        <p className="mt-1 text-xs text-subtle">
          Traders cannot add commodities themselves; they submit approval requests that land in your Approvals inbox.
        </p>

        <div className="mt-4">
          <CommodityRegistrationFields
            value={form}
            onChange={setForm}
            quantityUnitOptions={quantityUnitOptions}
            tradeParameterDefs={tradeParams}
            onTradeParameterDefsChange={setTradeParams}
            unitListId="ceo-commodity-unit-options"
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={addCommodity.isPending || !form.name.trim() || !form.code.trim() || !form.unit.trim()}
            onClick={() => {
              setSuccess(null);
              addCommodity.mutate(buildCommodityCreatePayload(form, tradeParams));
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-kastros-bg disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Register commodity
          </button>
          {addCommodity.error && (
            <p className="text-sm text-kastros-red">{addCommodity.error.message}</p>
          )}
          {success && (
            <p className="inline-flex items-center gap-1.5 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" />
              {success}
            </p>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-kastros-border bg-kastros-card">
        <div className="border-b border-kastros-border px-5 py-3">
          <h2 className="text-sm font-semibold text-foreground">Registered commodities</h2>
          {listFilters.controls}
          <p className="text-xs text-subtle">{commodities.data?.length ?? 0} total</p>
          {deleteError && <p className="mt-1 text-xs text-kastros-red">{deleteError}</p>}
        </div>
        <div className="max-h-96 overflow-y-auto divide-y divide-kastros-border">
          {listFilters.rows.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
              <div className="min-w-0">
                <span className="font-mono font-medium text-foreground">{c.code}</span>
                <span className="ml-2 text-muted-foreground">{c.name}</span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-subtle">{c.unit}</span>
                <button
                  type="button"
                  disabled={deleteCommodity.isPending}
                  onClick={() => {
                    setSuccess(null);
                    setDeleteError(null);
                    if (confirm(`Delete commodity ${c.code} — ${c.name}? Traders will no longer see it in dropdowns.`)) {
                      deleteCommodity.mutate({ id: c.id });
                    }
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-kastros-border px-2 py-1 text-xs text-kastros-red hover:bg-kastros-red/10 disabled:opacity-50"
                  title="Delete commodity"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </button>
              </div>
            </div>
          ))}
          {!commodities.isLoading && !(commodities.data?.length ?? 0) && (
            <p className="px-5 py-6 text-sm text-subtle">No commodities registered yet.</p>
          )}
        </div>
      </section>
      </div>
    </div>
  );
}
