"use client";
import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { PROCESSING_ROUTES } from "@/lib/sesame-processing";
import { isSesameCommodity } from "@/lib/sesame";
import { useExecutionCommodityDesk } from "./commodity-desk-provider";
import { SesameGradeStock } from "./sesame-grade-stock";

export function ProcessedGoods() {
  const {active,entity} = useExecutionCommodityDesk();
  const utils = trpc.useUtils();
  const enabled = isSesameCommodity(active.code) && entity !== "FZCO";
  const transfers = trpc.execution.stockTransfers.useQuery({}, {enabled,refetchInterval:30000});
  const batches = trpc.sesameExecution.processing.useQuery(undefined,{enabled,refetchInterval:30000});
  const [transferId,setTransferId] = useState("");
  const [toType,setToType] = useState<"Machine Cleaned"|"Sortex">("Machine Cleaned");
  const [inputKg,setInputKg] = useState("");
  const [yieldRatio,setYieldRatio] = useState("0.98");
  const [requestKey,setRequestKey] = useState(()=>crypto.randomUUID());
  const [saved,setSaved] = useState(false);
  const record = trpc.sesameExecution.recordProcessing.useMutation({onSuccess:()=>{setInputKg("");setRequestKey(crypto.randomUUID());setSaved(true);void utils.invalidate();}});
  const selected = transfers.data?.find(t=>t.id===transferId);
  const eligible = (transfers.data??[]).filter(t=>t.purpose==="PROCESSING" && t.status==="RECEIVED" && (t.receivedQtyMt??0)*1000-(batches.data??[]).filter(b=>b.transferId===t.id).reduce((s,b)=>s+b.inputKg,0)>0.0001);
  const used = (batches.data??[]).filter(b=>b.transferId===transferId).reduce((s,b)=>s+b.inputKg,0);
  const routes = PROCESSING_ROUTES.filter(r=>r.from===selected?.sesameType);
  const output = Number(inputKg)*Number(yieldRatio);
  if (!enabled) return <div className="kastros-desk-page">Open the Pakistan Sesame desk to process goods.</div>;
  return <div className="kastros-desk-page space-y-5"><header><h1 className="text-2xl font-semibold">Processed Goods</h1><p className="mt-2 text-sm text-subtle">Send stock using an internal processing truck, receive it at the processing warehouse, then record its yield. Output and impurities stay at that warehouse until shifted back.</p></header>
    <Link href="/execution/movements?scope=internal" className="kastros-btn-secondary inline-block">Internal trucks and gate links</Link>
    <SesameGradeStock />
    <form className="kastros-card p-5 space-y-4" onSubmit={e=>{e.preventDefault();setSaved(false);record.mutate({transferId,toType,inputKg:Number(inputKg),yieldRatio:Number(yieldRatio),requestKey});}}>
      <h2 className="font-semibold">Record processing yield</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm">Received processing truck<select className="kastros-select mt-1 w-full" required value={transferId} onChange={e=>{setTransferId(e.target.value);const t=eligible.find(t=>t.id===e.target.value);setToType(t?.sesameType==="Machine Cleaned"?"Sortex":"Machine Cleaned");setRequestKey(crypto.randomUUID());}}><option value="">Select truck</option>{eligible.map(t=><option key={t.id} value={t.id}>{t.transferRef} · {t.truckNo} · {t.toWarehouseName} · {t.sesameType}</option>)}</select></label>
        <label className="text-sm">Conversion<select className="kastros-select mt-1 w-full" required value={toType} onChange={e=>setToType(e.target.value as typeof toType)}>{routes.map(r=><option key={r.to} value={r.to}>{r.from} → {r.to}</option>)}</select></label>
        <label className="text-sm">Amount being processed (kg)<input className="kastros-input mt-1 w-full" required type="number" step="0.001" min="0.001" max={selected?(selected.receivedQtyMt??0)*1000-used:undefined} value={inputKg} onChange={e=>setInputKg(e.target.value)} />{selected && <span className="text-xs text-subtle">Remaining from this truck: {((selected.receivedQtyMt??0)*1000-used).toFixed(3)} kg</span>}</label>
        <label className="text-sm">Yield ratio (0.98 = 98%)<input className="kastros-input mt-1 w-full" required type="number" min="0" max="1" step="0.000001" value={yieldRatio} onChange={e=>setYieldRatio(e.target.value)} /></label>
      </div>
      {inputKg && Number(yieldRatio)>=0 && Number(yieldRatio)<=1 && <p className="text-sm">Yield: {(Number(yieldRatio)*100).toFixed(2)}% · {toType}: {output.toFixed(3)} kg · Impurities: {(Number(inputKg)-output).toFixed(3)} kg</p>}
      <button className="kastros-btn-primary" disabled={record.isPending || !selected || !routes.length}>{record.isPending?"Saving…":"Record and update stock"}</button>
      {saved && <p role="status">Processing recorded. Stock has been updated.</p>}{record.error && <p role="alert" className="text-destructive">{record.error.message}</p>}
      {!eligible.length && <p className="text-sm text-subtle">No received processing trucks have unprocessed stock. Book a processing movement in Internal Trucks first.</p>}
    </form>
    {(transfers.error || batches.error) && <p role="alert">{transfers.error?.message ?? batches.error?.message}</p>}
    <section className="kastros-card overflow-auto p-4"><h2 className="font-semibold mb-3">Processing history</h2><table className="w-full text-sm"><thead><tr>{["Recorded","Truck / warehouse","Conversion","Input kg","Yield","Output kg","Impurities kg","Recorded by"].map(h=><th key={h} className="p-2 text-left">{h}</th>)}</tr></thead><tbody>{batches.data?.map(b=><tr key={b.id} className="border-t border-border"><td className="p-2">{new Date(b.createdAt).toLocaleString("en-PK")}</td><td className="p-2">{b.transfer.truckNo} · {b.warehouseName}</td><td className="p-2">{b.fromType} → {b.toType}</td><td className="p-2">{b.inputKg}</td><td className="p-2">{(b.yieldRatio*100).toFixed(2)}%</td><td className="p-2">{b.outputKg}</td><td className="p-2">{b.impuritiesKg}</td><td className="p-2">{b.recordedBy}</td></tr>)}</tbody></table></section>
  </div>;
}
