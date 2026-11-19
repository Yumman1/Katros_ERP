'use client';
import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';

import type {PkeShipmentReview} from '@/lib/pke-shipment-review';
type Row={id:string;title:string;tradeRef:string;saleRef:string;contractMt:number;toleranceMt:number;invoiceMt:number;blMt:number;receivedMt:number;arrived:boolean;reviews:PkeShipmentReview[]};
export function PkeShipmentReviews({fileId,trader=false}:{fileId?:string;trader?:boolean}){
 const cache=useQueryClient();const [reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const q=useQuery<{files:Row[];insurers:{id:string;name:string}[]}>({queryKey:['pke-shipment-reviews'],queryFn:async()=>{const r=await fetch('/api/pke-shipment-reviews');const d=await r.json();if(!r.ok)throw new Error(d.error);return d;},refetchInterval:30000});
 const insurerId=q.data?.insurers.find(i=>i.name.toLowerCase()==='atlas')?.id||'';
 async function send(data:object){setBusy(true);setError('');try{const r=await fetch('/api/pke-shipment-reviews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const d=await r.json();if(!r.ok)throw new Error(d.error);await cache.invalidateQueries();}catch(e){setError(e instanceof Error?e.message:'Failed');}finally{setBusy(false);}}
 return <section className="kastros-card p-4 space-y-3"><h3 className="font-semibold">PKE shipment approvals and insurance</h3>{(error||q.error)&&<p role="alert" className="text-destructive">{error||q.error?.message}</p>}
 {!trader&&<p>Insurer: ATLAS</p>}
 <label className="block">Request / decision reason<textarea className="kastros-input w-full" value={reason} onChange={e=>setReason(e.target.value)} maxLength={2000}/></label>
 {q.data?.files.filter(f=>!fileId||f.id===fileId).map(f=><div className="rounded-lg border p-3 space-y-2" key={f.id}><p>{f.title} · {f.tradeRef} → {f.saleRef||'Unlinked'}</p><p>Contract {f.contractMt} MT · BL {f.blMt} MT · Invoice {f.invoiceMt} MT · Received {f.receivedMt} MT · Tolerance {f.toleranceMt} MT</p>
 {!trader&&<div className="flex flex-wrap gap-2">{f.arrived&&f.invoiceMt>0&&f.invoiceMt-f.receivedMt>f.invoiceMt*.005+.000001&&<button className="kastros-btn-secondary" disabled={busy||!insurerId||!reason.trim()||f.reviews.some(r=>r.kind==='INSURANCE'&&r.status!=='REJECTED')} onClick={()=>send({id:f.id,action:'INSURANCE',insurerId,reason})}>Claim Insurance</button>}<button className="kastros-btn-secondary" disabled={busy||!reason.trim()||f.reviews.some(r=>r.kind==='SHORTFALL'&&r.status!=='REJECTED')} onClick={()=>send({id:f.id,action:'SHORTFALL',reason})}>Notify trader of final BL shortfall</button></div>}
 {f.reviews.map(r=><div key={r.id} className="rounded border p-3"><p>{r.kind} · {r.status} · {r.quantityMt} MT{r.kind==='INSURANCE'?` · ${r.insurerName} · ${r.amountPkr.toLocaleString()} PKR`:''}</p><p>{r.reason}</p>{r.noteRef&&<p>Receive payment through Vouchers → Insurance receipt → {r.insurerName} → {r.noteRef}.</p>}{trader&&r.status==='PENDING'&&<div className="flex gap-2">{['APPROVED','REJECTED',...(r.kind==='SHORTFALL'?['CANCELLED']:[])].map(action=><button className="kastros-btn-secondary" key={action} disabled={busy||!reason.trim()} onClick={()=>{if(window.confirm(action==='CANCELLED'?'Cancel this purchase and linked trades? Cleared payments and actual stock remain for reconciliation.':`${action==='APPROVED'?'Approve':'Reject'} request?`))void send({id:f.id,reviewId:r.id,action,reason});}}>{action==='APPROVED'?'Approve / proceed':action==='CANCELLED'?'Cancel linked trades':'Reject'}</button>)}</div>}</div>)}</div>)}
 </section>;
}
