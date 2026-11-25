"use client";
import {useState} from 'react';
import {trpc} from '@/lib/trpc/client';
import {calculatePkeCost,DEFAULT_PKE_COST_POLICY,PKE_EXECUTION_COST_FIELDS,PKE_TAX_KEYS,validatePkeCostPatch,type PkeCostKey} from '@/lib/pke-costing';
const money=(n:number)=>n.toLocaleString('en-PK',{minimumFractionDigits:2,maximumFractionDigits:2});
export function PkeCostEstimate({invoiceAmount,quantityMt,currency='USD',compact=false,editable=false}:{invoiceAmount:number;quantityMt:number;currency?:'USD'|'PKR';compact?:boolean;editable?:boolean}){
 const utils=trpc.useUtils();
 const query=trpc.policy.get.useQuery(undefined,{refetchOnWindowFocus:true,staleTime:0});
 const [overrides,setOverrides]=useState<Partial<Record<PkeCostKey,string>>>({});
 const [fx,setFx]=useState(''),[saveError,setSaveError]=useState('');
 const save=trpc.policy.updatePkeExecutionCosts.useMutation({onSuccess:async()=>{await utils.policy.get.invalidate();setOverrides({});}});
 const basePolicy=query.data?.pkeCosting??DEFAULT_PKE_COST_POLICY;
 const policy={...basePolicy,...Object.fromEntries(Object.entries(overrides).map(([key,value])=>[key,value?.trim()===''?NaN:Number(value)]))};
 const exchangeRate=editable?policy.exchangeRate:fx===''?policy.exchangeRate:Number(fx);
 function edit(key:PkeCostKey,value:string){setOverrides(v=>({...v,[key]:value}));setSaveError('');save.reset();}
 if(query.isLoading)return <p>Loading costing rates…</p>;
 if(query.error)return <p role="alert">{query.error.message}</p>;
 let estimate:ReturnType<typeof calculatePkeCost>|null=null,error='';
 if(invoiceAmount>0&&quantityMt>0)try{estimate=calculatePkeCost({invoiceAmount,quantityMt,currency,exchangeRate},policy);}catch(e){error=e instanceof Error?e.message:'Invalid estimate';}
 return <section className="space-y-5">
  <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Pakistan landed cost estimate</h2>{!editable&&<label className="text-sm">Estimate USD/PKR<input className="kastros-input ml-2 w-32" aria-label="Estimate USD/PKR" type="number" min="0.000001" step="any" value={fx===''?policy.exchangeRate:fx} onChange={e=>setFx(e.target.value)}/></label>}</div>
  {editable&&<div className="space-y-4"><div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">{PKE_EXECUTION_COST_FIELDS.map(([key,label,unit])=><label key={key} className="text-sm">{label} <span className="text-muted-foreground">({unit})</span><input aria-label={label} className="kastros-input mt-1 w-full" type="number" min={key==='exchangeRate'?0.000001:0} max={unit==='%'?100:undefined} step="any" value={overrides[key]??basePolicy[key]} onChange={e=>edit(key,e.target.value)}/></label>)}</div><div className="flex flex-wrap items-center gap-3"><button type="button" className="kastros-btn-primary" disabled={save.isPending||!Object.keys(overrides).length} onClick={()=>{try{const patch=validatePkeCostPatch(Object.fromEntries(Object.entries(overrides).map(([key,value])=>[key,value?.trim()===''?NaN:Number(value)])),'EXECUTION');save.mutate(patch as Record<string,number>);}catch(e){setSaveError(e instanceof Error?e.message:'Invalid costs');}}}>Save execution defaults</button><button type="button" className="kastros-btn-secondary" disabled={!Object.keys(overrides).length||save.isPending} onClick={()=>{setOverrides({});setSaveError('');save.reset();}}>Reset estimate</button>{save.isSuccess&&<span role="status" className="text-sm text-success">Execution defaults saved.</span>}</div></div>}
  {(error||saveError||save.error)&&<p role="alert" className="text-destructive">{error||saveError||save.error?.message}</p>}
  {estimate?<><div className="grid gap-4 sm:grid-cols-3"><div className="rounded-2xl bg-accent-secondary/10 p-5">
    <span className="text-xs uppercase tracking-wide">Ex Port</span>
    <p className="mt-2 text-lg font-semibold">PKR {money(estimate.exPort)}</p>
    <p className="mt-1 text-sm">PKR {money(estimate.exPort / quantityMt)} / MT · PKR {money(estimate.exPort / (quantityMt * 20))} / 50 kg bag</p>
    <p className="mt-1 text-sm">Entry rate: PKR {money(estimate.entryRatePkrPerKg)} / kg</p>
   </div>
    <div className="rounded-2xl bg-accent-secondary/10 p-5"><span className="text-xs uppercase tracking-wide">Ex Warehouse</span><p className="mt-2 text-lg font-semibold">PKR {money(estimate.exWarehouse)}</p></div>
    <div className="rounded-2xl bg-emerald-500/10 p-5 text-success"><span className="text-xs uppercase tracking-wide">Delivered total</span><p className="mt-2 text-lg font-semibold">PKR {money(estimate.delivered)}</p></div>
   </div><p className="text-sm font-medium">Taxes and duties: PKR {money(estimate.taxes)}</p>
  <details open={!compact}><summary className="cursor-pointer text-sm">Taxes and cost breakdown</summary><div className="overflow-x-auto"><table className="mt-3 w-full text-sm"><thead><tr className="text-left"><th className="p-2">Item</th><th className="p-2">Rate / basis</th><th className="p-2 text-right">PKR</th></tr></thead><tbody>{estimate.lines.map(line=>{
   const canEdit=editable&&line.key&&!PKE_TAX_KEYS.includes(line.key);
   return <tr className="border-b border-border/50" key={line.label}><td className="p-2">{line.label}</td><td className="p-2">{canEdit?<div className="flex items-center gap-2"><input aria-label={`${line.label} rate`} className="kastros-input w-28" type="number" min="0" max={line.unit==='%'?100:undefined} step="any" value={overrides[line.key!]??line.rate} onChange={e=>edit(line.key!,e.target.value)}/><span>{line.unit}</span></div>:<>{line.rate!==undefined?`${line.rate} ${line.unit}`:'—'}{line.basis?` · ${line.basis}`:''}</>}</td><td className="p-2 text-right tabular-nums">{canEdit?<input aria-label={`${line.label} total PKR`} className="kastros-input w-40 text-right" type="number" min="0" step="0.01" value={Number(line.amount.toFixed(2))} onChange={e=>{const base=line.key==='insurancePct'?estimate!.lines[0].amount:line.key==='cessPct'?estimate!.customsBase:quantityMt;edit(line.key!,String(Number(e.target.value)/base*(line.unit==='%'?100:1)));}}/>:money(line.amount)}</td></tr>;
  })}</tbody></table></div><p className="mt-3 text-sm text-muted-foreground">Customs assessment value: PKR {money(estimate.customsBase)}</p></details></>:<p className="text-sm">Enter the trade value and quantity.</p>}
 </section>;
}
