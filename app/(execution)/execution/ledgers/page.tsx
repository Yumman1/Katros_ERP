"use client";

import { useExecutionCommodityDesk } from "@/components/execution/commodity-desk-provider";
import Link from "next/link";
import { CounterpartyLedgersPanel } from "@/components/ledgers/counterparty-ledgers-panel";
import { PageHeader } from "@/components/ui/page-header";
import { DESK_REFETCH_MS } from "@/lib/invalidate-caches";
import { trpc } from "@/lib/trpc/client";

export default function ExecutionLedgersPage() {
  const { active } = useExecutionCommodityDesk();
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
        title={`${active.name} Ledgers`}
        subtitle={`Buy and sell accounts for ${active.name} only. Vouchers, balances and available truck funding are kept separate from other commodities. Amounts are settled in PKR.`}
      />

      <div className="kastros-desk-scroll flex flex-col gap-4">
        <CounterpartyLedgersPanel enableFilters rows={data} isLoading={isLoading} />
      </div>
    </div>
  );
}
