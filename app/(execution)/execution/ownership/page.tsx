"use client";
import { OwnershipTrades } from "@/components/execution/sesame-entity-panels";
import { useExecutionCommodityDesk } from "@/components/execution/commodity-desk-provider";
import { isSesameCommodity } from "@/lib/sesame";
export default function OwnershipPage() {
  const { active } = useExecutionCommodityDesk();
  return <div className="kastros-desk-page">{isSesameCommodity(active.code) ? <OwnershipTrades /> : <p>Ownership transfers are available in the Sesame desk.</p>}</div>;
}
