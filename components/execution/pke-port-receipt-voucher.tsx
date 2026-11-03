"use client";
import type {PkeReceiptQuote} from "@/lib/pke-receipt-quote";
import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useExecutionCommodityDesk} from '@/components/execution/commodity-desk-provider';
type Port={id:string;title:string;vessel:string;port:string;blNo:string;purchaseTradeRef:string;saleTradeRef:string;quantityMt:number;remainingMt:number;freeMt:number;warehouseMt:number;soldMt:number;sales:{tradeRef:string;buyer:string;locked:boolean;remainingMt:number}[]};
type Data={files:Port[];warehouses:{name:string}[];balances:{receiptQuote:PkeReceiptQuote|null;tradeRef:string;counterparty:string;currency:string;amount:number;paid:number;pending:number;remaining:number}[]};
async function response(r:Response){const v=await r.json();if(!r.ok)throw new Error(v.error);return v;}
export function PkePortReceiptVoucher(){
 const {active,entity}=useExecutionCommodityDesk();const cache=useQueryClient();
 const query=useQuery<Data>({queryKey:['pke-port'],queryFn:()=>fetch('/api/pke-port').then(response),enabled:active.code==='PKE'&&entity==='PAK'});
 const [sale,setSale]=useState(''),[amount,setAmount]=useState<string|null>(null),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[key,setKey]=useState(()=>crypto.randomUUID());
 const quote=query.data?.balances.find(b=>b.tradeRef===sale)?.receiptQuote;
 const receiptAmount=amount??(quote?quote.availablePkr.toFixed(2):'');
 const pkr=(n:number)=>n.toLocaleString('en-PK',{minimumFractionDigits:2,maximumFractionDigits:2});
 async function send(body:object){setBusy(true);setError('');try{const result=await fetch('/api/pke-port',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,requestKey:key||crypto.randomUUID()})}).then(response);setMessage(result.voucherNo?`${result.voucherNo} sent to Finance. Finance enters the payment reference.`:`${result.gatepassNo??'Movement'} recorded. Truck approvals are in Truck Movements.`);setKey(crypto.randomUUID());await cache.invalidateQueries();return true;}catch(e){setError(e instanceof Error?e.message:'Unable to save');return false;}finally{setBusy(false);}}
 return <section className="mb-4"> <form className="kastros-card p-4 space-y-3" onChange={()=>setKey(crypto.randomUUID())} onSubmit={e=>{e.preventDefault();if(!quote)return;if(window.confirm(`Generate receipt voucher for ${sale}: PKR ${pkr(Number(receiptAmount))}?`))void send({action:'receipt-voucher',tradeRef:sale,amountPkr:Number(receiptAmount)}).then(ok=>{if(ok)setAmount(null);});}}><h2 className="font-semibold">Receive payment for a local port sale</h2><label className="block">Sale<select required value={sale} onChange={e=>{setSale(e.target.value);setAmount(null);}} className="kastros-select w-full"><option value="">Select local sale</option>{query.data?.files.flatMap(f=>f.sales).filter(s=>s.locked).map(s=><option key={s.tradeRef} value={s.tradeRef}>{s.tradeRef} · {s.buyer}</option>)}</select></label>
 {quote&&<div className="rounded-lg border border-border p-3 space-y-2 text-sm" aria-live="polite">
 <p>Sale quantity: <strong>{quote.quantityMt.toLocaleString()} MT</strong> · Locked rate: <strong>{pkr(quote.ratePkrPerKg)} PKR/kg</strong></p>
 <p>Agreed sale amount: <strong>PKR {pkr(quote.agreedPkr)}</strong> ({quote.quantityMt.toLocaleString()} MT × 1,000 × {pkr(quote.ratePkrPerKg)})</p>
 {quote.billedExtraPkr>0&&<p>Additional billed charges: PKR {pkr(quote.billedExtraPkr)}</p>}
 <p>Expected total: <strong>PKR {pkr(quote.expectedPkr)}</strong></p>
 <p>Already received: PKR {pkr(quote.paidPkr)} · Awaiting Finance: PKR {pkr(quote.pendingPkr)}</p>
 <p>Unpaid balance: PKR {pkr(quote.remainingPkr)}</p>
 <p>Available to request: <strong>PKR {pkr(quote.availablePkr)}</strong></p>
 </div>}
 <label className="block">Receipt amount (PKR)<input required type="number" min="0.01" step="0.01" max={quote?.availablePkr} value={receiptAmount} onChange={e=>setAmount(e.target.value)} className="kastros-input w-full"/></label><p className="text-xs text-muted-foreground">Defaults to the remaining amount after approved and pending receipts. Enter a smaller amount for a partial payment.</p><button disabled={busy||!quote||Number(receiptAmount)<=0||Number(receiptAmount)>quote.availablePkr} className="kastros-btn-primary">Generate receipt voucher</button></form>{query.error&&<p role="alert">{query.error.message}</p>}{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}</section>;
}
