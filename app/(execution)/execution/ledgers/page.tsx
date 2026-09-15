"use client";

import Link from "next/link";
import { CounterpartyLedgersPanel } from "@/components/ledgers/counterparty-ledgers-panel";
import { PageHeader } from "@/components/ui/page-header";
import { DESK_REFETCH_MS } from "@/lib/invalidate-caches";
import { trpc } from "@/lib/trpc/client";

export default function ExecutionLedgersPage() {
  const { data, isLoading } = trpc.execution.counterpartyLedgers.useQuery(undefined, {
    refetchInterval: DESK_REFETCH_MS,
  });

  return (
    <div className="kastros-desk-page">
      <PageHeader
        breadcrumb={
          <>
            <Link href="/execution" className="hover:text-foreground">
              Desk
            </Link>
            <span>/</span>
            <span className="text-muted-foreground">Counterparty Ledgers</span>
          </>
        }
        title="Counterparty Ledgers"
        subtitle="Buy and sell ledger accounts per counterparty — debit, credit and balance on both sides; mirrored from Finance."
      />

      <div className="kastros-desk-scroll flex flex-col gap-4">
        <CounterpartyLedgersPanel enableFilters rows={data} isLoading={isLoading} />
      </div>
    </div>
  );
}
