"use client";
import {useState} from 'react';
import {gatepassInputClass as inputClass} from './gatepass-form-fields';
const blank=()=>({truckNo:'',containerNo:'',croNo:'',weightKg:''});
export function SesameExportContainers({tradeRef,warehouseName,recordedByName,onSaved}:{tradeRef:string;warehouseName:string;recordedByName:string;onSaved:()=>void}){
 const [rows,setRows]=useState([blank()]);const [key,setKey]=useState(()=>crypto.randomUUID());const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [success,setSuccess]=useState('');
 const [transporter,setTransporter]=useState('');
 const total=rows.reduce((a,r)=>a+(Number(r.weightKg)||0),0);
 async function save(){setBusy(true);setError('');setSuccess('');try{const response=await fetch('/api/warehouse-export-gatepass',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestKey:key,tradeRef,warehouseName,recordedByName,transporterName:transporter,containers:rows.map(r=>({...r,weightKg:Number(r.weightKg)}))})});const data=await response.json();if(!response.ok)throw new Error(data.error);setSuccess(`Saved to shipment ${data.shipment.id.slice(-8)} · ${data.shipment.totalWeightKg.toLocaleString()} kg total. Execution can generate one DO for the group.`);setRows([blank()]);setKey(crypto.randomUUID());onSaved();}catch(e){setError(e instanceof Error?e.message:'Could not save');}finally{setBusy(false);}}
 return <section className="rounded-xl border border-border p-4 space-y-4"><h2 className="font-semibold">Outbound details — international Sesame shipment</h2><p className="text-sm text-subtle">Each truck carries one container. Entries join the open shipment for this trade and warehouse until its DO is generated.</p>
 <label className="block">Transporter name<input className={inputClass} value={transporter} onChange={e=>setTransporter(e.target.value)}/></label>
 {rows.map((r,i)=><fieldset key={i} className="border border-border p-3 rounded-lg"><legend>Container / Truck {i+1}</legend><div className="grid gap-3 sm:grid-cols-2">{([['truckNo','Truck number'],['containerNo','Container number'],['croNo','CRO number'],['weightKg','Container / Truck Weight (kg)']] as const).map(([key,label])=><label key={key}>{label} *<input className={inputClass} type={key==='weightKg'?'number':'text'} min={key==='weightKg'?'.001':undefined} step={key==='weightKg'?'.001':undefined} value={r[key]} onChange={e=>setRows(old=>old.map((row,j)=>j===i?{...row,[key]:e.target.value}:row))}/></label>)}</div>{rows.length>1&&<button type="button" className="kastros-btn-secondary mt-2" disabled={busy} onClick={()=>setRows(old=>old.filter((_,j)=>j!==i))}>Remove container</button>}</fieldset>)}
 <button type="button" className="kastros-btn-secondary" disabled={busy||rows.length>=100} onClick={()=>setRows(old=>[...old,blank()])}>+ Add Container / Truck</button>
 <p className="font-semibold">Shipment total: {total.toLocaleString('en-PK',{maximumFractionDigits:3})} kg ({(total/1000).toFixed(3)} MT)</p>
 {error&&<p role="alert" className="text-destructive">{error}</p>}{success&&<p role="status">{success}</p>}
 <button type="button" className="kastros-btn-primary" disabled={busy||!tradeRef||!warehouseName||!recordedByName.trim()||rows.some(r=>!r.truckNo.trim()||!r.containerNo.trim()||!r.croNo.trim()||Number(r.weightKg)<=0||!Number.isFinite(Number(r.weightKg)))} onClick={()=>void save()}>{busy?'Saving…':'Save container gatepasses'}</button>
 </section>;
}
