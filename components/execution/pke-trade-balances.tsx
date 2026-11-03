"use client";
import {useQuery} from '@tanstack/react-query';
type Balance={tradeRef:string;counterparty:string;currency:string;amount:number;paid:number;pending:number;remaining:number};
export function PkeTradeBalances(){
 const query=useQuery<{balances:Balance[]}>({queryKey:['pke-port'],queryFn:async()=>{const r=await fetch('/api/pke-port');const d=await r.json();if(!r.ok)throw new Error(d.error);return d;}});
 return <section className="space-y-3"><h2 className="font-semibold">PKE balances by trade</h2><p className="text-sm">Approved payments reduce the trade balance. Pending vouchers reserve funds but do not count as paid.</p>{query.error&&<p role="alert">{query.error.message}</p>}<div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{['Trade','Counterparty','Currency','Contract value','Paid / received','Pending','Remaining'].map(h=><th className="p-2 text-left" key={h}>{h}</th>)}</tr></thead><tbody>{query.data?.balances.map(b=><tr key={b.tradeRef}>{[b.tradeRef,b.counterparty,b.currency,b.amount,b.paid,b.pending,b.remaining].map((v,i)=><td className="p-2" key={i}>{typeof v==='number'?v.toLocaleString():v}</td>)}</tr>)}</tbody></table></div></section>;
}
