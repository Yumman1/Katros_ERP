"use client";

import { useState } from "react";
import { CounterpartyLedgersPanel } from "@/components/ledgers/counterparty-ledgers-panel";
import { PageHeader } from "@/components/ui/page-header";
import { trpc } from "@/lib/trpc/client";

export default function FinanceLedgersPage() {
  const utils = trpc.useUtils();
  const { data: rows, isLoading, error: rowsError } = trpc.finance.counterpartyLedgers.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: false,
  });

  const [settleError, setSettleError] = useState<string | null>(null);

  const settle = trpc.finance.settleSaleTruck.useMutation({
    onSuccess: () => {
      setSettleError(null);
      void utils.finance.counterpartyLedgers.invalidate();
      void utils.policy.overdueLedgerAlerts.invalidate();
      void utils.execution.counterpartyLedgers.invalidate();
      void utils.execution.saleWorkflowRows.invalidate();
    },
    onError: (e) => setSettleError(e.message),
  });

  const handleSettle = (truckId: string) => {
    if (!window.confirm("Settle this truck against the buyer's available credit?")) return;
    setSettleError(null);
    settle.mutate({ truckId });
  };

  return (
    <div className="kastros-desk-page">
      <PageHeader
        title="Counterparty Ledgers"
        subtitle="One ledger account per counterparty per side — sell receivables and buy payables, with balances, available credit, and aging."
      />
      <div className="kastros-desk-scroll space-y-4 pb-6">
        {settleError && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {settleError}
          </p>
        )}
        {rowsError ? (
          <div className="exec-empty">You don&apos;t have access to this page.</div>
        ) : (
          <CounterpartyLedgersPanel
            rows={rows}
            isLoading={isLoading}
            onSettle={handleSettle}
            settlingTruckId={settle.isPending ? settle.variables?.truckId ?? null : null}
          />
        )}
      </div>
    </div>
  );
}
