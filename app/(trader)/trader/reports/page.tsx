"use client";
import { useState } from "react";
import { CornCounterpartyReportPanel } from "@/components/reports/corn-counterparty-report";
import { CommercialReportPanel } from "@/components/reports/commercial-report";
import { useCommodityDesk } from "@/components/trader/commodity-desk-provider";
export default function Page() {
  const desk = useCommodityDesk();
  const [view,setView] = useState("mtm");
  if (!desk.active) return <p>{desk.error ?? "Select an assigned commodity to view reports."}</p>;
  if (desk.active.code.toUpperCase() === "CORN") return <div className="kastros-desk-page space-y-5"><nav aria-label="Report type" className="flex gap-3"><button className={view === "mtm" ? "kastros-btn-primary" : "kastros-btn-secondary"} onClick={()=>setView("mtm")}>Counterparty MTM</button><button className={view === "margins" ? "kastros-btn-primary" : "kastros-btn-secondary"} onClick={()=>setView("margins")}>Sales & margins</button></nav>{view === "mtm" ? <CornCounterpartyReportPanel key={desk.active.id} commodityId={desk.active.id}/> : <CommercialReportPanel key={desk.active.id} scope="trader" deskCommodityId={desk.active.id}/>}</div>;
  return <CommercialReportPanel key={desk.active.id} scope="trader" deskCommodityId={desk.active.id} />;
}
