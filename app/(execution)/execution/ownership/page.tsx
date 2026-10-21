"use client";
import { FzcoBook } from "@/components/execution/sesame-entity-panels";
import { useExecutionCommodityDesk } from "@/components/execution/commodity-desk-provider";
import { isSesameCommodity } from "@/lib/sesame";
export default function OwnershipPage() {
  const { active } = useExecutionCommodityDesk();
  return <div className="kastros-desk-page">{isSesameCommodity(active.code) ? <FzcoBook commodityCode={active.code} /> : <p>Dubai FZCO books are available on the Sesame desk.</p>}</div>;
}
