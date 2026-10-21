"use client";
import {useState} from 'react';
import {useExecutionCommodityDesk} from './commodity-desk-provider';
import {trpc} from '@/lib/trpc/client';
export function FzcoDirectEntry(){
 const {active}=useExecutionCommodityDesk();const query=trpc.sesameExport.directParties.useQuery();const utils=trpc.useUtils();
 const [counterpartyId,setParty]=useState(''),[holderId,setHolder]=useState(''),[transporterName,setTransporter]=useState(''),[documents,setDocuments]=useState(''),[date,setDate]=useState(()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Karachi'})),[message,setMessage]=useState('');
 const side = 'SELL' as const;
 const triparty = true;
 const empty=()=>({truckNo:'',containerNo:'',croNo:'',weightKg:''});
 const [rows,setRows]=useState([empty()]);const [requestKey,setKey]=useState(()=>crypto.randomUUID());
 const save=trpc.sesameExport.logDirect.useMutation({onSuccess:r=>{setMessage(`Saved ${r.gatepasses.join(", ")}. Assign a trade in Truck Movement.`);setRows([empty()]);setKey(crypto.randomUUID());void utils.invalidate();}});

 return <form className="kastros-card p-5 space-y-4" onSubmit={e=>{e.preventDefault();save.mutate({requestKey,counterpartyId,holderId,side,triparty,commodityCode:active.code,movementDate:new Date(date+'T12:00:00+05:00'),transporterName,documentLinks:documents.split('\n').map(v=>v.trim()).filter(Boolean),containers:rows.map(r=>({...r,weightKg:Number(r.weightKg)}))});}}>
 <h2 className="text-xl font-semibold">Third-party truck movement</h2><p className="text-sm text-subtle">Record a shipment from the supplier holding FZCO’s stock to the buyer. Purchases are recorded against the supplier automatically when locked.</p>
 <div className="grid gap-3 md:grid-cols-2"><div><span className="block">Contract type</span><p className="font-semibold">Triparty: Supplier → FZCO → Buyer</p></div>
 <label>{side==='SELL'?'Buyer (party we are selling to)':'Supplier'}<select required className="kastros-select fzco-select w-full" value={counterpartyId} onChange={e=>setParty(e.target.value)}><option value="">Select counterparty</option>{query.data?.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
 <label>{triparty?"Supplier holding our stock (party we bought from)":"Stock holder"}<select required className="kastros-select fzco-select w-full" value={holderId} onChange={e=>setHolder(e.target.value)}><option value="">Select third party holding the stock</option>{query.data?.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
 <label>Movement date<input required type="date" className="kastros-input w-full" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Transporter<input required className="kastros-input w-full" maxLength={120} value={transporterName} onChange={e=>setTransporter(e.target.value)}/></label></div>
 {rows.map((r,i)=><fieldset key={i} className="border border-border rounded p-3 grid gap-3 md:grid-cols-5"><legend>Container / truck {i+1}</legend>{(['truckNo','containerNo','croNo','weightKg'] as const).map((k,j)=><label key={k}>{['Truck number',triparty?'Container number':'Container number (if applicable)',triparty?'CRO number':'CRO / transport reference (if applicable)','Container / Truck Weight (kg)'][j]}<input required={triparty||k==='truckNo'||k==='weightKg'} className="kastros-input w-full" type={k==='weightKg'?'number':'text'} min={k==='weightKg'?'.001':undefined} step={k==='weightKg'?'.001':undefined} maxLength={120} value={r[k]} onChange={e=>setRows(rows.map((row,n)=>n===i?{...row,[k]:e.target.value}:row))}/></label>)}<button type="button" className="kastros-btn-secondary" disabled={rows.length===1} onClick={()=>setRows(rows.filter((_,n)=>n!==i))}>Remove</button></fieldset>)}
 <button type="button" className="kastros-btn-secondary" disabled={rows.length>=100} onClick={()=>setRows([...rows,empty()])}>+ Add Container / Truck</button><p className="font-semibold">Shipment total: {rows.reduce((a,r)=>a+Number(r.weightKg||0),0).toLocaleString()} kg</p>
 <label className="block">Supporting document links (HTTPS, one per line)<textarea className="kastros-input w-full" value={documents} onChange={e=>setDocuments(e.target.value)} placeholder="Supplier gatepass, weight slip, loading documents"/></label>
 <button className="kastros-btn-primary" disabled={save.isPending}>Save truck movements</button>{(query.error||save.error)&&<p role="alert" className="text-destructive">{query.error?.message||save.error?.message}</p>}{message&&<p role="status">{message}</p>}
 </form>;
}
