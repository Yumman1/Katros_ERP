"use client";
import type {PkeReceiptQuote} from "@/lib/pke-receipt-quote";
import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useExecutionCommodityDesk} from '@/components/execution/commodity-desk-provider';
type Port={id:string;title:string;vessel:string;port:string;blNo:string;purchaseTradeRef:string;saleTradeRef:string;quantityMt:number;remainingMt:number;freeMt:number;warehouseMt:number;soldMt:number;sales:{tradeRef:string;buyer:string;locked:boolean;remainingMt:number}[]};
type Data={files:Port[];warehouses:{name:string}[];balances:{receiptQuote:PkeReceiptQuote|null;tradeRef:string;counterparty:string;currency:string;amount:number;paid:number;pending:number;remaining:number}[]};
async function response(r:Response){const v=await r.json();if(!r.ok)throw new Error(v.error);return v;}
export default function PkePortPage(){
 const {active,entity,selectEntity}=useExecutionCommodityDesk();const cache=useQueryClient();
 const query=useQuery<Data>({queryKey:['pke-port'],queryFn:()=>fetch('/api/pke-port').then(response),enabled:active.code==='PKE'});
 const [fileId,setFile]=useState(''),[quantity,setQuantity]=useState(''),[truck,setTruck]=useState(''),[builty,setBuilty]=useState(''),[sale,setSale]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[key,setKey]=useState(()=>crypto.randomUUID());
 const row=query.data?.files.find(f=>f.id===fileId);
 async function send(body:object){setBusy(true);setError('');try{const result=await fetch('/api/pke-port',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,requestKey:key||crypto.randomUUID()})}).then(response);setMessage(result.voucherNo?`${result.voucherNo} sent to Finance. Finance enters the payment reference.`:`${result.gatepassNo??'Movement'} recorded. Truck approvals are in Truck Movements.`);setKey(crypto.randomUUID());await cache.invalidateQueries();return true;}catch(e){setError(e instanceof Error?e.message:'Unable to save');return false;}finally{setBusy(false);}}
 if(active.code!=='PKE')return <p className="p-6">Select PKE to view port stock.</p>;
 if(entity!=='PAK')return <div className="p-6 space-y-3"><p>Vessel arrival is entered in Dubai Import Files. Pakistan manages port sales and warehouse gate-ins.</p><button className="kastros-btn-primary" onClick={()=>selectEntity('PAK','/execution/pke-port')}>Open Pakistan port sales</button></div>;
 return <div className="kastros-desk-page"><h1 className="text-xl font-semibold">PKE local port sales</h1><div className="kastros-desk-scroll space-y-5">
 <p>Record vessel arrival in Dubai Import Files first. Port stock is separate from warehouse inventory. Each movement uses only the entered quantity; the rest remains at the port.</p>
 <label className="block">Vessel / BL<select className="kastros-select w-full" value={fileId} onChange={e=>{setFile(e.target.value);setSale('');setKey(crypto.randomUUID());}}><option value="">Select arrived shipment</option>{query.data?.files.filter(f=>f.vessel&&f.remainingMt>0).map(f=><option key={f.id} value={f.id}>{f.vessel} · {f.port} · BL {f.blNo} · {f.remainingMt} MT at port</option>)}</select></label>
 {row&&<><p>Supplier: {row.purchaseTradeRef} · Dubai sale / Pakistan purchase: {row.saleTradeRef}</p><p>Received: {row.quantityMt} MT · Warehouse receipts: {row.warehouseMt} MT · Port-sale trucks: {row.soldMt} MT · At port: {row.remainingMt} MT · Unbooked: {row.freeMt} MT</p>
 <form className="kastros-card p-4 grid gap-3 md:grid-cols-2" onChange={()=>setKey(crypto.randomUUID())} onSubmit={async e=>{e.preventDefault();if(!window.confirm('Record this truck movement?'))return;if(await send({fileId,kind:'PORT_SALE',quantityMt:Number(quantity),truckNo:truck,builty,saleTradeRef:sale||undefined})){setQuantity('');setTruck('');setBuilty('');}}}>
 <label>Local sale contract<select required className="kastros-select w-full" value={sale} onChange={e=>setSale(e.target.value)}><option value="">Select approved port sale</option>{row.sales.filter(s=>s.locked&&s.remainingMt>0).map(s=><option key={s.tradeRef} value={s.tradeRef}>{s.tradeRef} · {s.buyer} · {s.remainingMt} MT remaining</option>)}</select></label>
 <label>Quantity (MT)<input required type="number" min="0.000001" step="0.000001" max={Math.min(row.remainingMt,row.sales.find(s=>s.tradeRef===sale)?.remainingMt??0)} className="kastros-input w-full" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
 <label>Truck number<input required className="kastros-input w-full" value={truck} onChange={e=>setTruck(e.target.value)}/></label><label>Builty number<input required className="kastros-input w-full" value={builty} onChange={e=>setBuilty(e.target.value)}/></label><button disabled={busy} className="kastros-btn-primary">Record port-sale truck</button></form>
</>}
 {error&&<p role="alert" className="text-destructive">{error}</p>}{query.error&&<p role="alert">{query.error.message}</p>}{message&&<p role="status">{message}</p>}
 <p>Receive payments in <a className="underline" href="/execution/vouchers">Vouchers</a>. After payment clears, generate the DO in Truck Movements. Record warehouse arrivals using the triparty gate-in option in the gatepass link.</p>
 </div></div>;
}
