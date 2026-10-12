"use client";
import { OwnershipTrades } from "@/components/execution/sesame-entity-panels";
import { useExecutionCommodityDesk } from "@/components/execution/commodity-desk-provider";
import { isSesameCommodity } from "@/lib/sesame";
export default function OwnershipPage() {
  const { active, entity } = useExecutionCommodityDesk();
  return <div className="kastros-desk-page">{isSesameCommodity(active.code) ? <OwnershipTrades commodityCode={active.code} entity={entity} /> : <p>Ownership transfers are available in the Sesame desk.</p>}</div>;
}
