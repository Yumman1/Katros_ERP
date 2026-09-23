"use client";
import { CommercialReportPanel } from "@/components/reports/commercial-report";
import { useCommodityDesk } from "@/components/trader/commodity-desk-provider";
export default function Page() {
  const desk = useCommodityDesk();
  if (!desk.active) return <p>{desk.error ?? "Select an assigned commodity to view reports."}</p>;
  return <CommercialReportPanel key={desk.active.id} scope="trader" deskCommodityId={desk.active.id} />;
}
