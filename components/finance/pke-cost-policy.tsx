"use client";
import {useEffect,useState} from 'react';
import {trpc} from '@/lib/trpc/client';
import {PKE_COST_FIELDS,DEFAULT_PKE_COST_POLICY,type PkeCostPolicy,validatePkeCostPolicy} from '@/lib/pke-costing';
export function PkeCostPolicyForm(){
 const utils=trpc.useUtils(),query=trpc.policy.get.useQuery();
 const [values,setValues]=useState<Record<string,string>>({}),[error,setError]=useState('');
 const save=trpc.policy.update.useMutation({onSuccess:()=>{void utils.policy.get.invalidate();}});
 useEffect(()=>{if(query.data)setValues(Object.fromEntries(PKE_COST_FIELDS.map(([k])=>[k,String((query.data.pkeCosting??DEFAULT_PKE_COST_POLICY)[k])])));},[query.data]);
 return <section className="exec-panel space-y-4"><h2 className="text-lg font-semibold">PKE import costing</h2><form onSubmit={e=>{e.preventDefault();setError('');try{if(Object.values(values).some(v=>!v.trim()))throw new Error('Fill in every rate');const policy=Object.fromEntries(PKE_COST_FIELDS.map(([k])=>[k,Number(values[k])])) as PkeCostPolicy;validatePkeCostPolicy(policy);save.mutate({pkeCosting:policy});}catch(e){setError(e instanceof Error?e.message:'Invalid values');}}}><div className="grid gap-3 md:grid-cols-3">{PKE_COST_FIELDS.map(([key,label,unit])=><label key={key} className="block text-sm">{label} ({unit})<input required type="number" min={key==='exchangeRate'?0.000001:0} max={unit==='%'?100:undefined} step="any" className="kastros-input mt-1 w-full" value={values[key]??''} onChange={e=>setValues(v=>({...v,[key]:e.target.value}))}/></label>)}</div>{(error||save.error)&&<p role="alert" className="mt-3 text-destructive">{error||save.error?.message}</p>}{save.isSuccess&&!save.isPending&&<p role="status" className="mt-3 text-success">PKE costing policy saved.</p>}<button className="kastros-btn-primary mt-4" disabled={save.isPending||query.isLoading}>{save.isPending?'Saving…':'Save PKE costing'}</button></form></section>;
}
