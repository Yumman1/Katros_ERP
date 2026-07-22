"use client";

import { CounterpartyLedgersPanel } from "@/components/ledgers/counterparty-ledgers-panel";
import { PageHeader } from "@/components/ui/page-header";
import { trpc } from "@/lib/trpc/client";

export default function FinanceLedgersPage() {
  const { data: rows, isLoading } = trpc.finance.counterpartyLedgers.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  return (
    <div className="kastros-desk-page">
      <PageHeader
        title="Counterparty Ledgers"
        subtitle="Running credit / debit ledger for every sell-side buyer — balances, available credit, and receivable aging."
      />
      <div className="kastros-desk-scroll pb-6">
        <CounterpartyLedgersPanel rows={rows} isLoading={isLoading} />
      </div>
    </div>
  );
}
