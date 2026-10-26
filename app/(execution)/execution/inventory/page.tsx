"use client";

import { useExecutionCommodityDesk } from "@/components/execution/commodity-desk-provider";
import { InventoryStatistics } from "@/components/execution/inventory-statistics";
import { SesameInventoryView, SesamePakistanInventoryExtras } from "@/components/execution/sesame-entity-panels";
import { usesSesameWorkflow } from "@/lib/sesame";

export default function ExecutionInventoryPage() {
  const { active, entity } = useExecutionCommodityDesk();
  const sesame = usesSesameWorkflow(active.code);
  if (sesame && entity === "FZCO") {
    return <SesameInventoryView commodityCode={active.code} entity="FZCO" />;
  }
  return (
    <InventoryStatistics commodityCode={active.code}>
      {sesame ? <SesamePakistanInventoryExtras commodityCode={active.code} /> : null}
    </InventoryStatistics>
  );
}
