"use client";

import { useState } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { invalidateGateOpsCaches } from "@/lib/invalidate-caches";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { ErrorLine, StepPanel, WorkflowCard } from "@/components/execution/workflow-step";

const qty = (n: number) => n.toLocaleString("en-PK", { maximumFractionDigits: 3 });
const kg = (n: number) =>
  `${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(n)} kg`;

export function ExportGateAssignment() {
  const q = trpc.sesameExport.pendingGates.useQuery(undefined, { refetchInterval: 15_000 });
  const utils = trpc.useUtils();
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [fzcoRefs, setFzcoRefs] = useState<Record<string, string>>({});
  const save = trpc.sesameExport.assignGate.useMutation({
    onSuccess: () => {
      invalidateGateOpsCaches(utils);
      void utils.sesameExport.invalidate();
    },
  });

  if (!q.data?.length && !q.error) return null;

  return (
    <>
      {q.error && (
        <p role="alert" className="text-sm text-destructive">
          {q.error.message}
        </p>
      )}
      {q.data?.map((r) => {
        const totalKg = r.input.containers.reduce((a, c) => a + c.weightKg, 0);
        const tradeRef = refs[r.id] ?? "";
        const fzcoRef = fzcoRefs[r.id] ?? "";
        const canAssign = Boolean(tradeRef) && (!r.triparty || Boolean(fzcoRef));
        return (
          <WorkflowCard key={r.id}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-bold text-accent-secondary">
                  {r.gatepasses[0]}
                  {r.gatepasses.length > 1 ? ` + ${r.gatepasses.length - 1}` : ""}
                </span>
                <span className="rounded-full exec-badge-intl px-1.5 py-0.5 text-[9px] font-bold">OUT</span>
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[9px] font-bold",
                    r.triparty ? "bg-amber-500/15 text-amber-600" : "exec-badge-intl",
                  )}
                >
                  {r.triparty ? "Triparty" : "International"}
                </span>
              </div>
              <div className="ml-auto font-mono text-sm font-bold text-accent-secondary">{kg(totalKg)}</div>
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-kastros-border/60 pt-2.5 text-xs sm:grid-cols-4">
              {(
                [
                  ["Buyer", r.counterpartyName],
                  ["Warehouse", r.warehouseName],
                  ["Commodity", r.commodityCode],
                  ["Containers", String(r.input.containers.length)],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-subtle">{label}</div>
                  <div className="truncate text-foreground">{value}</div>
                </div>
              ))}
            </div>
            <ul className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
              {r.input.containers.map((c, i) => (
                <li key={r.gatepasses[i] ?? i}>
                  {r.gatepasses[i]} · {c.truckNo} · {c.containerNo} · CRO {c.croNo} · {kg(c.weightKg)}
                </li>
              ))}
            </ul>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <StepPanel step={1} title="Assign trade" state="active">
                {r.triparty && (
                  <span className="text-[10px] text-subtle">
                    Pakistan sells to Dubai FZCO; containers ship to {r.counterpartyName} on FZCO&apos;s sale.
                  </span>
                )}
                {r.triparty ? (
                  <div className="grid gap-2">
                    <SearchableSelect
                      value={tradeRef}
                      onChange={(e) => setRefs({ ...refs, [r.id]: e.target.value })}
                      className="kastros-input kastros-input-sm py-1.5 text-[11px]"
                      aria-label="Pakistan to Dubai FZCO sale"
                    >
                      <option value="">Pakistan → FZCO sale…</option>
                      {r.internalChoices.map((t) => (
                        <option key={t.tradeRef} value={t.tradeRef}>
                          {t.tradeRef} · {t.grade} · {qty(t.openMt)} MT open
                        </option>
                      ))}
                    </SearchableSelect>
                    <SearchableSelect
                      value={fzcoRef}
                      onChange={(e) => setFzcoRefs({ ...fzcoRefs, [r.id]: e.target.value })}
                      className="kastros-input kastros-input-sm py-1.5 text-[11px]"
                      aria-label={`Dubai FZCO sale to ${r.counterpartyName}`}
                    >
                      <option value="">FZCO → {r.counterpartyName}…</option>
                      {r.fzcoChoices.map((t) => (
                        <option key={t.tradeRef} value={t.tradeRef}>
                          {t.tradeRef} · {t.grade} · {qty(t.openMt)} MT open
                        </option>
                      ))}
                    </SearchableSelect>
                    {!r.internalChoices.length && (
                      <ErrorLine message="No open Pakistan → FZCO internal sale for this warehouse." />
                    )}
                    {!r.fzcoChoices.length && (
                      <ErrorLine message={`No open FZCO sale to ${r.counterpartyName}.`} />
                    )}
                  </div>
                ) : (
                  <SearchableSelect
                    value={tradeRef}
                    onChange={(e) => setRefs({ ...refs, [r.id]: e.target.value })}
                    className="kastros-input kastros-input-sm py-1.5 text-[11px]"
                    aria-label="Sale trade"
                  >
                    <option value="">Select trade…</option>
                    {r.choices.map((t) => (
                      <option key={t.tradeRef} value={t.tradeRef}>
                        {t.tradeRef} · {t.entity}
                      </option>
                    ))}
                  </SearchableSelect>
                )}
                <button
                  type="button"
                  className="kastros-btn-primary self-start px-3 py-1.5 text-[11px] disabled:opacity-50"
                  disabled={!canAssign || save.isPending}
                  onClick={() =>
                    save.mutate({
                      id: r.id,
                      tradeRef,
                      ...(r.triparty ? { fzcoSaleTradeRef: fzcoRef } : {}),
                    })
                  }
                >
                  {save.isPending ? "Assigning…" : "Assign"}
                </button>
                {save.error && <ErrorLine message={save.error.message} />}
              </StepPanel>
              <StepPanel step={2} title="Shipment" state="waiting" headline="After trade assignment">
                <span className="text-[10px] text-subtle">
                  Generate one delivery order for the group, then release and record the BL — the same path as a local
                  outbound, with grouped documents.
                </span>
              </StepPanel>
            </div>
          </WorkflowCard>
        );
      })}
    </>
  );
}
