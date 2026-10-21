"use client";
import {useState} from 'react';
import {trpc} from '@/lib/trpc/client';
export function FzcoGateAssignment(){
 const query=trpc.sesameExport.pendingDirect.useQuery(undefined,{refetchInterval:15000});
 const utils=trpc.useUtils();
 const [purchases,setPurchases]=useState<Record<string,string>>({});
 const [refs,setRefs]=useState<Record<string,string>>({});
 const assign=trpc.sesameExport.assignDirect.useMutation({onSuccess:()=>{void utils.invalidate();}});
 return <section className="kastros-card p-5 space-y-4"><h2 className="text-xl font-semibold">Awaiting trade assignment</h2>
 {query.isLoading&&<p>Loading trade choices…</p>}
 {query.data?.map(r=>{
  const sale=r.choices.find(t=>t.tradeRef===refs[r.id]);
  const weightMt=r.input.containers.reduce((sum,t)=>sum+t.weightKg,0)/1000;
  const compatible=r.purchaseChoices.filter(t=>t.grade===sale?.grade&&t.availableMt+.000001>=weightMt);
  const selected=compatible.find(t=>t.tradeRef===purchases[r.id]);
  return <div key={r.id} className="border border-border rounded p-4 space-y-3">
   <p>{r.counterparty} · {r.input.side==='SELL'?'Triparty sale':'Purchase (existing entry)'}</p>
   {r.input.containers.map((t,i)=><p key={i}>{r.gatepasses[i]} · {t.truckNo} · {t.containerNo||'—'} · {t.weightKg.toLocaleString()} kg</p>)}
   <label className="block">{r.input.triparty?'Buyer sale reference':'Purchase reference'}<select className="kastros-select fzco-select w-full" value={sale?.tradeRef??''} onChange={e=>{setRefs({...refs,[r.id]:e.target.value});setPurchases({...purchases,[r.id]:''});assign.reset();}}><option value="">Select matching trade</option>{r.choices.map(t=><option key={t.tradeRef} value={t.tradeRef}>{t.tradeRef} · {t.grade} · {t.openMt.toFixed(3)} MT remaining to move</option>)}</select></label>
   {r.input.triparty&&<label className="block">Supplier purchase reference<select className="kastros-select fzco-select w-full" disabled={!sale} value={selected?.tradeRef??''} onChange={e=>{setPurchases({...purchases,[r.id]:e.target.value});assign.reset();}}><option value="">{sale?'Select matching supplier purchase':'Select the buyer sale first'}</option>{compatible.map(t=><option key={t.tradeRef} value={t.tradeRef}>{t.tradeRef} · {t.counterparty} · {t.grade} · {t.availableMt.toFixed(3)} MT available</option>)}</select></label>}
   {r.input.triparty&&sale&&!compatible.length&&<p role="status">No {sale.grade} purchase held by this supplier has {weightMt.toFixed(3)} MT available. {r.purchaseChoices.length?`Supplier purchases: ${r.purchaseChoices.map(t=>`${t.tradeRef} (${t.grade}, ${t.availableMt.toFixed(3)} MT available)`).join('; ')}.`:'Book and lock a purchase from the selected supplier first.'} Select a matching sale or correct the trade grade before assigning.</p>}
   <button className="kastros-btn-primary" disabled={!sale||(r.input.triparty&&!selected)||assign.isPending} onClick={()=>assign.mutate({id:r.id,tradeRef:sale!.tradeRef,sourcePurchaseTradeRef:r.input.triparty?selected?.tradeRef:undefined})}>Assign trade</button>
   {!r.choices.length&&<p>No matching trade with quantity remaining to move. Book and lock the trade for this counterparty first.</p>}
  </div>;
 })}
 {!query.isLoading&&!query.error&&!query.data?.length&&<p>No entries awaiting assignment.</p>}
 {(query.error||assign.error)&&<p role="alert">{query.error?.message||assign.error?.message}</p>}
 </section>;
}
