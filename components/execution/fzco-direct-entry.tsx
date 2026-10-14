"use client";
import {useState} from 'react';
import {trpc} from '@/lib/trpc/client';
export function FzcoDirectEntry(){
 const query=trpc.sesameExport.directTrades.useQuery();const utils=trpc.useUtils();
 const [tradeRef,setTrade]=useState(''),[dispatchLocation,setLocation]=useState(''),[transporterName,setTransporter]=useState(''),[documents,setDocuments]=useState(''),[date,setDate]=useState(()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Karachi'})),[message,setMessage]=useState('');
 const empty=()=>({truckNo:'',containerNo:'',croNo:'',weightKg:''});
 const [rows,setRows]=useState([empty()]);const [requestKey,setKey]=useState(()=>crypto.randomUUID());
 const save=trpc.sesameExport.addDirect.useMutation({onSuccess:r=>{setMessage(`Saved ${r.trucks.length} containers for ${r.tradeRef}. Manage the group below in Truck Movement.`);setRows([empty()]);setKey(crypto.randomUUID());void utils.invalidate();}});
 const selected=query.data?.find(t=>t.tradeRef===tradeRef);
 return <form className="kastros-card p-5 space-y-4" onSubmit={e=>{e.preventDefault();save.mutate({requestKey,tradeRef,dispatchLocation,movementDate:new Date(date+'T12:00:00+05:00'),transporterName,documentLinks:documents.split('\n').map(v=>v.trim()).filter(Boolean),containers:rows.map(r=>({...r,weightKg:Number(r.weightKg)}))});}}>
 <h2 className="text-xl font-semibold">Third-party truck movement</h2><p className="text-sm text-subtle">Record a purchase or a sale independently. These movements do not use or change Pakistan warehouse stock.</p>
 <div className="grid gap-3 md:grid-cols-2"><label>Trade reference<select required className="kastros-select w-full" value={tradeRef} onChange={e=>{setTrade(e.target.value);setKey(crypto.randomUUID());}}><option value="">Select purchase or sale</option>{query.data?.map(t=><option key={t.tradeRef} value={t.tradeRef}>{t.tradeRef} · {t.side} · {t.counterparty}</option>)}</select></label>
 <p>{selected?`${selected.commodity} · ${selected.counterparty} · ${selected.openMt.toFixed(3)} MT open · USD`:''}</p>
 <label>Supplier / dispatch location<input required className="kastros-input w-full" maxLength={120} value={dispatchLocation} onChange={e=>setLocation(e.target.value)}/></label><label>Movement date<input required type="date" className="kastros-input w-full" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Transporter<input required className="kastros-input w-full" maxLength={120} value={transporterName} onChange={e=>setTransporter(e.target.value)}/></label></div>
 {rows.map((r,i)=><fieldset key={i} className="border border-border rounded p-3 grid gap-3 md:grid-cols-5"><legend>Container / truck {i+1}</legend>{(['truckNo','containerNo','croNo','weightKg'] as const).map((k,j)=><label key={k}>{['Truck number','Container number (if applicable)','CRO / transport reference (if applicable)','Container / Truck Weight (kg)'][j]}<input required={k==='truckNo'||k==='weightKg'} className="kastros-input w-full" type={k==='weightKg'?'number':'text'} min={k==='weightKg'?'.001':undefined} step={k==='weightKg'?'.001':undefined} maxLength={120} value={r[k]} onChange={e=>setRows(rows.map((row,n)=>n===i?{...row,[k]:e.target.value}:row))}/></label>)}<button type="button" className="kastros-btn-secondary" disabled={rows.length===1} onClick={()=>setRows(rows.filter((_,n)=>n!==i))}>Remove</button></fieldset>)}
 <button type="button" className="kastros-btn-secondary" disabled={rows.length>=100} onClick={()=>setRows([...rows,empty()])}>+ Add Container / Truck</button><p className="font-semibold">Shipment total: {rows.reduce((a,r)=>a+Number(r.weightKg||0),0).toLocaleString()} kg</p>
 <label className="block">Supporting document links (HTTPS, one per line)<textarea className="kastros-input w-full" value={documents} onChange={e=>setDocuments(e.target.value)} placeholder="Supplier gatepass, weight slip, loading documents"/></label>
 <button className="kastros-btn-primary" disabled={save.isPending}>Save truck movements</button>{(query.error||save.error)&&<p role="alert" className="text-destructive">{query.error?.message||save.error?.message}</p>}{message&&<p role="status">{message}</p>}
 </form>;
}
