"use client";
import { useExecutionCommodityDesk } from "./commodity-desk-provider";
import { trpc } from '@/lib/trpc/client';
import type { PkePaymentSelection } from '@/server/finance/pke-import-payments';
export function PkePaymentSelectionFields({tradeRef,value,onChange}:{tradeRef:string;value:PkePaymentSelection|undefined;onChange:(v:PkePaymentSelection|undefined)=>void}) {
 const {active}=useExecutionCommodityDesk();
 const query=trpc.sesameExport.importPaymentOptions.useQuery({tradeRef},{enabled:!!tradeRef&&active.code==="PKE"});
 const file=query.data?.find(f=>f.fileId===value?.fileId);
 if(active.code!=="PKE")return null;
 if(!query.data?.length)return query.error?<p role="alert">{query.error.message}</p>:null;
 return <fieldset className="md:col-span-3 rounded-lg border p-3 space-y-3"><legend>PKE import payment</legend>
  <label className="block">Import file<select className="kastros-select w-full" value={value?.fileId??''} onChange={e=>onChange(e.target.value?{fileId:e.target.value,bl:false}:undefined)}><option value="">Trade payment / advance without BL or LC allocation</option>{query.data.map(f=><option key={f.fileId} value={f.fileId}>{f.title} · {f.blNo?`BL ${f.blNo}`:'BL not recorded'}</option>)}</select></label>
  {file&&<><label className="flex gap-2"><input type="checkbox" checked={value?.bl??false} onChange={e=>onChange({...value!,bl:e.target.checked})}/>Pay against BL {file.blNo??'(not recorded)'} · Available {file.blAvailable.toLocaleString()} {file.currency}</label>
   <label className="block">LC<select className="kastros-select w-full" value={value?.lcId??''} onChange={e=>onChange({...value!,lcId:e.target.value||undefined})}><option value="">Not an LC payment</option>{file.lcs.map(l=><option key={l.id} value={l.id}>{l.reference||'Missing reference'} · Available {l.available.toLocaleString()} {l.currency} · Paid {l.paid.toLocaleString()} · Pending {(l.used-l.paid).toLocaleString()}</option>)}</select></label>
   <p className="text-xs">Pending vouchers reserve the selected BL balance and LC limit. Rejection releases the reservation; Finance approval records payment. Use separate vouchers to draw on multiple LCs.</p>
  </>}
 </fieldset>;
}
