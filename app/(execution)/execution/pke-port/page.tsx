'use client';
import {useQuery} from '@tanstack/react-query';
import {useExecutionCommodityDesk} from '@/components/execution/commodity-desk-provider';
type Port={id:string;vessel:string;port:string;blNo:string;quantityMt:number;remainingMt:number;freeMt:number};
export default function PkePortPage(){
 const {active}=useExecutionCommodityDesk();
 const q=useQuery<{files:Port[]}>({queryKey:['pke-port'],enabled:active.code==='PKE',queryFn:async()=>{const r=await fetch('/api/pke-port');const d=await r.json();if(!r.ok)throw new Error(d.error);return d;}});
 if(active.code!=='PKE')return <p>Select PKE to view port stock.</p>;
 return <div className="kastros-desk-page space-y-4"><h1 className="text-xl font-semibold">PKE port stock</h1><p>Vessel receipts count as Pakistan physical inventory. Gate out through the normal gatepass link, selecting the port. Use Internal Shifting to move stock to warehouses.</p><div className="flex gap-4"><a className="kastros-btn-primary" href="/warehouse/gatepass" target="_blank" rel="noreferrer">Gatepass link</a><a className="underline" href="/execution/shifting">Internal Shifting</a><a className="underline" href="/execution/vouchers">Vouchers</a></div>{q.error&&<p role="alert">{q.error.message}</p>}<div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{['Vessel','Port','BL','Received MT','At port MT','Unbooked MT'].map(h=><th key={h} className="p-3 text-left">{h}</th>)}</tr></thead><tbody>{q.data?.files.map(f=><tr key={f.id}>{[f.vessel,f.port,f.blNo,f.quantityMt,f.remainingMt,f.freeMt].map((v,i)=><td key={i} className="p-3">{v}</td>)}</tr>)}</tbody></table></div></div>;
}
