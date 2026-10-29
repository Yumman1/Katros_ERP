"use client";
import {useState} from 'react';
import {trpc} from '@/lib/trpc/client';

export function InternalTradePayments(){
 const query=trpc.sesameExecution.internalPayments.useQuery();
 const utils=trpc.useUtils();
 const [tradeRef,setTrade]=useState('');
 const [amount,setAmount]=useState('');
 const [requestKey,setRequestKey]=useState('');
 const [message,setMessage]=useState('');
 const trade=query.data?.find(t=>t.tradeRef===tradeRef);
 const fx=trade?.currency==='USD' ? trade.fxRate : 1;
 const save=trpc.sesameExecution.createInternalPayment.useMutation({onSuccess:r=>{
  setMessage(`${r.voucherNo} sent to the Trader. Finance will enter one payment reference after approval. This voucher is visible on both desks.`);
  setTrade('');setAmount('');setRequestKey('');void utils.invalidate();
 }});
 return <section className="space-y-4 mt-4">
  <h3 className="font-semibold">Internal Trade — Pakistan / Dubai FZCO</h3>
  <p className="text-sm text-subtle">One voucher covers both sides of the internal trade. Generate it from either desk, obtain one Trader approval, then Finance records and approves the payment once.</p>
  <form className="grid gap-3 md:grid-cols-3" onSubmit={e=>{
   e.preventDefault();
   if(window.confirm('Send this shared internal trade voucher to the Trader for approval?'))
    save.mutate({tradeRef,requestKey,amountPkr:Math.round(Number(amount)*fx*100)/100});
  }}>
   <label>Trade<select required className="kastros-select w-full" value={tradeRef} onChange={e=>{
    const selected=query.data?.find(t=>t.tradeRef===e.target.value);
    setTrade(e.target.value);setRequestKey(crypto.randomUUID());setMessage('');
    const rate=selected?.currency==='USD'?selected.fxRate:1;
    setAmount(selected&&rate>0?(selected.availablePkr/rate).toFixed(2):'');
   }}><option value="">Select internal trade</option>{query.data?.filter(t=>t.locked).map(t=><option value={t.tradeRef} key={t.tradeRef} disabled={t.availablePkr<=.005}>{t.tradeRef} · {t.description}{t.availablePkr<=.005?' · paid or already requested':''}</option>)}</select></label>
   <label>Amount ({trade?.currency??'USD'})<input required type="number" min="0.01" step="0.01" className="kastros-input w-full" value={amount} onChange={e=>{setAmount(e.target.value);setRequestKey(crypto.randomUUID());}}/></label>
   <button className="kastros-btn-primary self-end" disabled={save.isPending||!trade||fx<=0||Number(amount)<=0}>Generate internal voucher</button>
   {trade&&fx>0&&<p className="text-sm md:col-span-3">Agreed value: {(trade.amountPkr/fx).toLocaleString(undefined,{maximumFractionDigits:2})} {trade.currency} · Unpaid: {(trade.outstandingPkr/fx).toLocaleString(undefined,{maximumFractionDigits:2})} {trade.currency} · Available to request: {(trade.availablePkr/fx).toLocaleString(undefined,{maximumFractionDigits:2})} {trade.currency}</p>}
   {trade&&fx<=0&&<p role="alert">Lock the trade exchange rate before generating the voucher.</p>}
  </form>
  {message&&<p role="status">{message}</p>}
  {(query.error||save.error)&&<p role="alert" className="text-destructive">{query.error?.message||save.error?.message}</p>}
  <p className="text-xs text-subtle">Shared vouchers, approval status and printable PDFs appear in the voucher history below. A partial payment leaves the balance open on both desks.</p>
 </section>;
}
