"use client";
import {useEffect,useState} from "react";
import type {PkeImportPayload} from "@/lib/pke-import";
import {SearchableSelect} from "@/components/ui/searchable-select";
import {PkeCostEstimate} from "./pke-cost-estimate";
import {type PkeCostPolicy} from "@/lib/pke-costing";

type Purchase={tradeRef:string;supplier:string;quantity:number;pricePerMt:number;currency:string;policy:PkeCostPolicy|null;charges:Partial<PkeCostPolicy>|null};
export function TradeCosting(){
 const [trades,setTrades]=useState<Purchase[]>([]);
 const [files,setFiles]=useState<{id:string;title:string;purchaseTradeRef:string;payload:PkeImportPayload}[]>([]);
 const [ref,setRef]=useState(""),[error,setError]=useState("");
 const trade=trades.find(t=>t.tradeRef===ref);
 useEffect(()=>{const controller=new AbortController();
  fetch("/api/pke-imports",{signal:controller.signal,cache:"no-store"}).then(async response=>{
   const result=await response.json();if(!response.ok)throw Error(result.error);
   setTrades(result.costPurchases);setFiles(result.files);
  }).catch(e=>{if(!controller.signal.aborted)setError(e.message)});
  return ()=>controller.abort();
 },[]);
 return <section className="kastros-card space-y-4 p-5"><label>Find purchase trade
  <SearchableSelect searchable className="kastros-select w-full" value={ref} onChange={e=>{setRef(e.target.value);setError("")}}>
   <option value="">Select trade</option>{trades.map(t=><option key={t.tradeRef} value={t.tradeRef}>{t.tradeRef} · {t.supplier}</option>)}
  </SearchableSelect></label>
  {trade&&<div key={ref} className="space-y-4"><p>{trade.quantity.toLocaleString()} MT at {trade.currency} {trade.pricePerMt} / MT</p>
   <p className="text-sm">Execution posts vessel costs in Import Files after arrival.</p>
   {files.filter(f=>f.payload.postedCost&&(f.purchaseTradeRef===ref||f.payload.postedCost.purchaseRef===ref)).map(f=>{
    const cost=f.payload.postedCost!;
    return <section key={f.id}><h3>{f.title} · Pakistan purchase {cost.purchaseRef}</h3><PkeCostEstimate lockedPolicy={cost.policy} invoiceAmount={cost.pricePerMt*cost.quantityMt} quantityMt={cost.quantityMt} currency={cost.currency}/></section>;
   })}
   {trade.policy&&trade.charges&&<details><summary>Previously saved trade estimate</summary>{(trade.currency==="USD"||trade.currency==="PKR")&&<PkeCostEstimate lockedPolicy={{...trade.policy,...trade.charges}} invoiceAmount={trade.pricePerMt*trade.quantity} quantityMt={trade.quantity} currency={trade.currency}/>}</details>}
  </div>}
  {error&&<p role="alert">{error}</p>}
 </section>
}
