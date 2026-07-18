"use client";

import { trpc } from "@/lib/trpc/client";
import { formatCurrency } from "@/lib/formatters/numbers";
import { ReconType } from "@prisma/client";
import { useState } from "react";
import { cn } from "@/lib/utils";

const tabs: { id: ReconType | "ALL"; label: string }[] = [
  { id: "ALL", label: "All" },
  { id: ReconType.TRADE_VS_INVOICE, label: "Trade vs Invoice" },
  { id: ReconType.INVOICE_VS_PAYMENT, label: "Invoice vs Payment" },
  { id: ReconType.POSITION_VS_INVENTORY, label: "Position vs Inventory" },
  { id: ReconType.PAYMENT_VS_BANK, label: "Payment vs Bank" },
];

export default function ReconciliationPage() {
  const [tab, setTab] = useState<"ALL" | ReconType>("ALL");
  const sum = trpc.reconciliation.summary.useQuery();
  const list = trpc.reconciliation.list.useQuery({
    type: tab === "ALL" ? undefined : tab,
  });
  const runAuto = trpc.reconciliation.runAutoTradeInvoice.useMutation();

  return (
    <div className="kastros-desk-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Reconciliation</h1>
          <p className="text-sm text-subtle">Three-way match status across trade lifecycle.</p>
        </div>
        <button
          type="button"
          onClick={() => runAuto.mutate()}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-kastros-bg"
        >
          Run auto-match (demo)
        </button>
      </div>

      {sum.data && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {Object.entries(sum.data).map(([k, v]) => (
            <div key={k} className="rounded-lg border border-kastros-border bg-kastros-card px-3 py-2">
              <div className="text-xs capitalize text-subtle">{k}</div>
              <div className="data-grid text-lg text-foreground">{v}</div>
            </div>
          ))}
        </div>
      )}

      {runAuto.data && (
        <div className="rounded border border-kastros-border bg-kastros-card px-3 py-2 text-sm text-muted-foreground">
          {runAuto.data.message} — matched {runAuto.data.matched}, breaks {runAuto.data.breaks}.
        </div>
      )}

      <div className="flex flex-wrap gap-1 border-b border-kastros-border pb-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-medium",
              tab === t.id ? "bg-white/10 text-success" : "text-subtle hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="kastros-table-wrap min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-kastros-card text-left text-xs uppercase text-subtle">
            <tr>
              {["Date", "Type", "Ref A", "Ref B", "Expected", "Actual", "Diff", "Status"].map((h) => (
                <th key={h} className="border-b border-kastros-border px-2 py-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="data-grid">
            {list.data?.map((r) => (
              <tr key={r.id} className="h-9 border-b border-kastros-border/60">
                <td className="px-2 py-1">{r.reconDate.toISOString().slice(0, 10)}</td>
                <td className="px-2 py-1 text-xs">{r.reconType}</td>
                <td className="px-2 py-1 text-muted-foreground">{r.referenceA}</td>
                <td className="px-2 py-1 text-muted-foreground">{r.referenceB}</td>
                <td className="px-2 py-1">{formatCurrency(Number(r.expectedAmount))}</td>
                <td className="px-2 py-1">{formatCurrency(Number(r.actualAmount))}</td>
                <td className="px-2 py-1">{formatCurrency(Number(r.difference))}</td>
                <td className="px-2 py-1">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-xs",
                      r.status === "MATCHED" && "bg-success/20 text-success",
                      r.status === "BREAK" && "bg-kastros-red/20 text-kastros-red",
                      r.status === "PENDING_REVIEW" && "bg-warning/20 text-warning",
                      r.status === "RESOLVED" && "bg-zinc-600/40 text-muted-foreground",
                    )}
                  >
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
