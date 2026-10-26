"use client";
import { FzcoBook } from "@/components/execution/sesame-entity-panels";
import { useExecutionCommodityDesk } from "@/components/execution/commodity-desk-provider";
import { usesSesameWorkflow } from "@/lib/sesame";
export default function OwnershipPage() {
  const { active } = useExecutionCommodityDesk();
  return <div className="kastros-desk-page">{usesSesameWorkflow(active.code) ? <FzcoBook commodityCode={active.code} /> : <p>Dubai FZCO books are available on the Sesame desk.</p>}</div>;
}
