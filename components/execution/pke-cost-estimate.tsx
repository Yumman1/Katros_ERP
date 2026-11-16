"use client";
import {useState} from 'react';
import {trpc} from '@/lib/trpc/client';
import {calculatePkeCost,DEFAULT_PKE_COST_POLICY} from '@/lib/pke-costing';
const money=(n:number)=>n.toLocaleString('en-PK',{minimumFractionDigits:2,maximumFractionDigits:2});
export function PkeCostEstimate({invoiceAmount,quantityMt,currency='USD',compact=false}:{invoiceAmount:number;quantityMt:number;currency?:'USD'|'PKR';compact?:boolean}){
 const query=trpc.policy.get.useQuery(undefined,{refetchOnWindowFocus:true,staleTime:0});
 const policy=query.data?.pkeCosting??DEFAULT_PKE_COST_POLICY;
 const [fx,setFx]=useState('');
 if(query.isLoading)return <p>Loading costing rates…</p>;
 if(query.error)return <p role="alert">{query.error.message}</p>;
 const exchangeRate=fx===''?policy.exchangeRate:Number(fx);
 let estimate:ReturnType<typeof calculatePkeCost>|null=null,error='';
 if(invoiceAmount>0&&quantityMt>0)try{estimate=calculatePkeCost({invoiceAmount,quantityMt,currency,exchangeRate},policy);}catch(e){error=e instanceof Error?e.message:'Invalid estimate';}
 return <section className="rounded-xl border border-border p-4 space-y-3"><h2 className="font-semibold">Pakistan landed cost estimate</h2><label className="block text-sm">Estimate USD/PKR<input className="kastros-input ml-2" aria-label="Estimate USD/PKR" type="number" min="0.000001" step="any" value={fx===''?policy.exchangeRate:fx} onChange={e=>setFx(e.target.value)}/></label>{error&&<p role="alert" className="text-destructive">{error}</p>}{estimate?<><div className="grid gap-3 sm:grid-cols-3">{[['Ex port',estimate.exPort],['Ex warehouse',estimate.exWarehouse],['Delivered total',estimate.delivered]].map(([label,value])=><div key={String(label)}><span className="text-xs text-muted-foreground">{label}</span><p className="font-semibold">PKR {money(Number(value))}</p></div>)}</div><p className="text-sm">PKR {money(estimate.perMt)} / MT · PKR {money(estimate.perBag)} / 50 kg · USD {money(estimate.usdPerMt)} / MT</p><p className="text-sm font-medium">Taxes and duties: PKR {money(estimate.taxes)}</p><details open={!compact}><summary className="cursor-pointer text-sm">Taxes and cost breakdown</summary><div className="overflow-x-auto"><table className="mt-3 w-full text-sm"><thead><tr className="text-left"><th className="p-2">Item</th><th className="p-2">Rate / basis</th><th className="p-2 text-right">PKR</th></tr></thead><tbody>{estimate.lines.map(line=><tr className="border-t border-border" key={line.label}><td className="p-2">{line.label}</td><td className="p-2">{line.rate!==undefined?`${line.rate} ${line.unit}`:'—'}{line.basis?` · ${line.basis}`:''}</td><td className="p-2 text-right tabular-nums">{money(line.amount)}</td></tr>)}</tbody></table></div><div className="mt-3 text-sm">Customs assessment value: PKR {money(estimate.customsBase)} · Includes {policy.landingPct}% landing allowance for tax calculation.</div><div className="mt-2 font-semibold">Total taxes and duties: PKR {money(estimate.taxes)}</div></details></>:<p className="text-sm">Enter the trade value and quantity.</p>}</section>;
}
