"use client";
import {useEffect,useState} from "react";
import {SearchableSelect} from "@/components/ui/searchable-select";
import {PkeCostEstimate} from "./pke-cost-estimate";
import {PKE_COST_FIELDS,portChargeKeys,type PkeCostPolicy} from "@/lib/pke-costing";

type Purchase={tradeRef:string;supplier:string;quantity:number;pricePerMt:number;currency:string;policy:PkeCostPolicy|null;charges:Partial<PkeCostPolicy>|null};
export function TradeCosting(){
 const [trades,setTrades]=useState<Purchase[]>([]);
 const [ref,setRef]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const trade=trades.find(t=>t.tradeRef===ref);
 useEffect(()=>{const controller=new AbortController();
  fetch("/api/pke-imports",{signal:controller.signal,cache:"no-store"}).then(async response=>{
   const result=await response.json();if(!response.ok)throw Error(result.error);
   setTrades(result.costPurchases);
  }).catch(e=>{if(!controller.signal.aborted)setError(e.message)});
  return ()=>controller.abort();
 },[]);
 return <section className="kastros-card space-y-4 p-5"><label>Find purchase trade
  <SearchableSelect searchable className="kastros-select w-full" value={ref} onChange={e=>{setRef(e.target.value);setError("")}}>
   <option value="">Select trade</option>{trades.map(t=><option key={t.tradeRef} value={t.tradeRef}>{t.tradeRef} · {t.supplier}</option>)}
  </SearchableSelect></label>
  {trade&&<div key={ref} className="space-y-4"><p>{trade.quantity.toLocaleString()} MT at {trade.currency} {trade.pricePerMt} / MT</p>
   {!trade.policy&&<p>This purchase predates booking snapshots. Saving the charges will lock the current costing policy.</p>}
   {!trade.charges&&<form className="grid gap-4 sm:grid-cols-2" onSubmit={async e=>{
    e.preventDefault();const data=new FormData(e.currentTarget);
    const rates=Object.fromEntries(portChargeKeys.map(k=>[k,Number(data.get(k))]));
    setBusy(true);setError("");
    try{const result=await fetch("/api/pke-imports",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"save-cost",tradeRef:ref,rates})});
     const saved=await result.json();if(!result.ok)throw Error(saved.error);
     setTrades(list=>list.map(t=>t.tradeRef===trade.tradeRef?{...t,charges:rates,policy:saved.policy}:t));
    }catch(err){setError(err instanceof Error?err.message:"Unable to save costing")}finally{setBusy(false)}
   }}>{portChargeKeys.map(k=>{const field=PKE_COST_FIELDS.find(f=>f[0]===k)!;
    return <label key={k}>{field[1]} ({field[2]})<input required min="0" max={k==="cessPct"?100:undefined} step="any" type="number" name={k} className="kastros-input block w-full"/></label>
   })}<button disabled={busy} className="kastros-btn-primary">Save trade costs</button></form>}
   {trade.policy&&trade.charges&&(trade.currency==="USD"||trade.currency==="PKR")&&<PkeCostEstimate lockedPolicy={{...trade.policy,...trade.charges}} invoiceAmount={trade.pricePerMt*trade.quantity} quantityMt={trade.quantity} currency={trade.currency}/>}
  </div>}
  {error&&<p role="alert">{error}</p>}
 </section>
}
