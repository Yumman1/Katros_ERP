"use client";
import {useState} from 'react';
import {trpc} from '@/lib/trpc/client';
export function FzcoGateAssignment(){
 const query=trpc.sesameExport.pendingDirect.useQuery(undefined,{refetchInterval:15000});const utils=trpc.useUtils();const [refs,setRefs]=useState<Record<string,string>>({});
 const assign=trpc.sesameExport.assignDirect.useMutation({onSuccess:()=>{void utils.invalidate();}});
 return <section className="kastros-card p-5 space-y-4"><h2 className="text-xl font-semibold">Awaiting trade assignment</h2>{query.data?.map(r=><div key={r.id} className="border border-border rounded p-4 space-y-2"><p>{r.counterparty} · {r.input.side} · {r.input.dispatchLocation}</p>{r.input.containers.map((t,i)=><p key={i}>{r.gatepasses[i]} · {t.truckNo} · {t.containerNo||'—'} · {t.weightKg.toLocaleString()} kg</p>)}<label>Trade reference<select className="kastros-select w-full" value={refs[r.id]??''} onChange={e=>setRefs({...refs,[r.id]:e.target.value})}><option value="">Select matching trade</option>{r.choices.map(t=><option key={t.tradeRef} value={t.tradeRef}>{t.tradeRef} · {t.openMt.toFixed(3)} MT open</option>)}</select></label><button className="kastros-btn-primary" disabled={!refs[r.id]||assign.isPending} onClick={()=>assign.mutate({id:r.id,tradeRef:refs[r.id]})}>Assign trade</button>{!r.choices.length&&<p>No open matching trade. Book and lock the trade first.</p>}</div>)}{!query.data?.length&&<p>No entries awaiting assignment.</p>}{(query.error||assign.error)&&<p role="alert">{query.error?.message||assign.error?.message}</p>}</section>;
}
