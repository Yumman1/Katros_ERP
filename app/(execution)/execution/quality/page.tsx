"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/components/ui/page-header";
import { isSesameCommodity, SESAME_FIELDS } from "@/lib/sesame";

export default function QualityReviewPage() {
  const utils=trpc.useUtils();
  const queue=trpc.execution.qualityReviewQueue.useQuery();
  const contracts=trpc.execution.lockedContracts.useQuery({});
  const [truckId,setTruckId]=useState(""); const [tradeRef,setTradeRef]=useState("");
  const [readings,setReadings]=useState<Record<string,string>>({}); const [deduction,setDeduction]=useState("0");
  const save=trpc.execution.recordTruckQuality.useMutation({onSuccess:()=>{void utils.execution.invalidate();void utils.trader.warehouseAvailability.invalidate();}});
  const truck=queue.data?.find(t=>t.id===truckId); const contract=contracts.data?.find(c=>c.tradeRef===tradeRef);
  const agreed=trpc.execution.qualityTradeSpecs.useQuery({tradeRef},{enabled:!!tradeRef});
  const spot=contract?.executionProfile==="PURCHASE_SPOT";
  const fields= isSesameCommodity(truck?.commodityCode) ? SESAME_FIELDS.filter(f=>f.group==="quality").map(f=>({key:f.key,label:f.label})) : [{key:"moisturePct",label:"Moisture (%)"},{key:"damagePct",label:"Damage (%)"},{key:"brokenPct",label:"Broken (%)"},{key:"fungusPct",label:"Fungus (%)"},{key:"foreignMatterPct",label:"Foreign matter (%)"}];
  const eligible=contracts.data?.filter(c=>c.direction==="BUY" && c.commodityCode===truck?.commodityCode && c.counterpartyName===truck.counterpartyName);
  return <div className="kastros-desk-page space-y-4 pb-6">
    <PageHeader title="Quality and Invoice" subtitle="Review allocated trucks, enter financial deductions and generate an invoice for trader approval. Physical inventory stays unchanged." />
    {(queue.error || contracts.error) && <p className="text-destructive">{queue.error?.message || contracts.error?.message}</p>}
    <section className="exec-panel space-y-4">
      <label className="block">Truck / builty<select className="kastros-select ml-2" value={truckId} onChange={e=>{const t=queue.data?.find(t=>t.id===e.target.value);setTruckId(e.target.value);setTradeRef(t?.assignedTradeRef??"");setReadings(t?.readings??{});setDeduction(String(t?.deductionKg??0));save.reset();}}><option value="">Select truck</option>{queue.data?.filter(t=>t.canInvoice).map(t=><option key={t.id} value={t.id}>{t.truckNo} · Builty {t.builty} · {t.gatepassNo} · {t.counterpartyName}</option>)}</select></label>
      {truck && <><p>{truck.warehouseName} · Seller weight {truck.sellerKg} kg · Warehouse weight {truck.warehouseKg} kg</p>
      <label className="block">Purchase trade<select className="kastros-select ml-2" value={tradeRef} disabled onChange={e=>{setTradeRef(e.target.value);setDeduction("0");}}><option value="">Select trade</option>{eligible?.map(c=><option key={c.tradeRef}>{c.tradeRef}</option>)}</select></label>
      {contract && <><p className="text-sm">{spot ? "Ex-Works — payable at seller loading weight. No deductions." : "Delivered — payable at warehouse weight less reviewed deduction."}</p>
      <p className="text-xs">Agreed quality: {agreed.data?.summary || "No quality specifications recorded"}</p>
      <div className="grid gap-3 sm:grid-cols-3">{fields.map(f=><label key={f.key} className="text-xs">{f.label}<input className="kastros-input w-full" value={readings[f.key]??""} onChange={e=>setReadings(r=>({...r,[f.key]:e.target.value}))} /></label>)}</div>
      <label className="block">Deduction (kg)<input className="kastros-input ml-2" type="number" min="0" step="0.001" disabled={spot} value={spot?"0":deduction} onChange={e=>setDeduction(e.target.value)} /></label>
      <p>Payable weight: {spot?truck.sellerKg:Math.max(0,truck.warehouseKg-Number(deduction))} kg</p>
      <button className="kastros-btn-primary" disabled={save.isPending} onClick={()=>save.mutate({truckId,tradeRef,readings,deductionKg:spot?0:Number(deduction)})}>Generate invoice</button></>}
      {save.error && <p className="text-destructive">{save.error.message}</p>}{save.isSuccess && <p className="text-success">Invoice generated and sent to the trade’s trader for approval.</p>}</>}
    </section>
    <section className="exec-panel"><h2 className="font-semibold">Generated invoices</h2>{queue.data?.filter(t=>t.reviewedAt).map(t=><p className="py-2 text-sm" key={t.id}>{t.truckNo} · Builty {t.builty} · {t.qualityTradeRef} · {t.invoiceNo} · {t.invoiceStage} · Deduction {t.deductionKg} kg · {t.reviewedBy}</p>)}</section>
  </div>;
}
