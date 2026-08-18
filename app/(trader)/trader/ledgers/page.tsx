"use client";

import Link from "next/link";
import { CounterpartyLedgersPanel } from "@/components/ledgers/counterparty-ledgers-panel";
import { DeskPage, DeskScroll } from "@/components/layout/desk-page";
import { PageHeader } from "@/components/ui/page-header";
import { DESK_REFETCH_MS } from "@/lib/invalidate-caches";
import { trpc } from "@/lib/trpc/client";

export default function TraderLedgersPage() {
  const { data, isLoading } = trpc.trader.counterpartyLedgers.useQuery(undefined, {
    refetchInterval: DESK_REFETCH_MS,
  });

  return (
    <DeskPage>
      <PageHeader
        breadcrumb={
          <>
            <Link href="/trader" className="hover:text-foreground">
              My Desk
            </Link>
            <span>/</span>
            <span className="text-muted-foreground">Counterparty Ledgers</span>
          </>
        }
        title="Counterparty Ledgers"
        subtitle="What buyers owe us and what we owe sellers — buy and sell accounts per counterparty, with billed, debited, and outstanding on purchases."
      />

      <DeskScroll className="flex flex-col gap-4 pb-6">
        <CounterpartyLedgersPanel rows={data} isLoading={isLoading} />
      </DeskScroll>
    </DeskPage>
  );
}
