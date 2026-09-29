"use client";

import { useExecutionCommodityDesk } from "@/components/execution/commodity-desk-provider";
import Link from "next/link";
import { CounterpartyLedgersPanel } from "@/components/ledgers/counterparty-ledgers-panel";
import { PageHeader } from "@/components/ui/page-header";
import { DESK_REFETCH_MS } from "@/lib/invalidate-caches";
import { trpc } from "@/lib/trpc/client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { isSesameCommodity } from "@/lib/sesame";
import { type SesameEntity } from "@/lib/sesame-entity";
import { SesameInternalLedger } from "@/components/execution/sesame-entity-panels";

export default function ExecutionLedgersPage() {
  const { active } = useExecutionCommodityDesk();
  const search = useSearchParams();
  const [entity, setEntity] = useState<SesameEntity | "">(search.get("entity") === "FZCO" ? "FZCO" : "");
  const sesame = isSesameCommodity(active.code);
  const { data, isLoading } = trpc.execution.counterpartyLedgers.useQuery(sesame && entity ? { entity } : undefined, {
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
        {sesame && <label className="text-sm" htmlFor="sesame-ledger-entity">Trading entity<select id="sesame-ledger-entity" aria-label="Trading entity" className="kastros-select ml-3" value={entity} onChange={e => setEntity(e.target.value as SesameEntity | "")}><option value="">All Sesame entities</option><option value="PAK">Kastros Pakistan</option><option value="FZCO">Dubai FZCO</option></select></label>}
        <CounterpartyLedgersPanel enableFilters rows={data} isLoading={isLoading} />
        {sesame && <SesameInternalLedger entity={entity || undefined} />}
      </div>
    </div>
  );
}
