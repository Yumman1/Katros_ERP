"use client";
import {trpc} from '@/lib/trpc/client';
import {CounterpartyLedgersPanel,type LedgerRow} from '@/components/ledgers/counterparty-ledgers-panel';
import {AGING_BUCKETS} from '@/lib/finance-policy';
export function FzcoUsdLedger({hideEmpty=false}:{hideEmpty?:boolean}){
 const q=trpc.sesameExport.usdLedger.useQuery(undefined,{refetchInterval:30000});
 const accounts=new Map<string,LedgerRow>();
 for(const trade of q.data??[]){
  const side=trade.side as 'BUY'|'SELL',key=`${trade.counterpartyId}-${side}`;
  const row=accounts.get(key)??{counterpartyId:trade.counterpartyId,counterpartyName:trade.counterparty,counterpartyCode:trade.counterpartyCode,side,ledgerAccountId:key,totalDebitPkr:0,totalCreditPkr:0,totalBilledPkr:0,settledDebitPkr:0,outstandingDebitPkr:0,balancePkr:0,availableCreditPkr:0,aging:Object.fromEntries(AGING_BUCKETS.map(b=>[b,0])) as LedgerRow['aging'],entries:[]};
  for(const e of trade.entries){if(e.amountUsd===null)continue;const value=e.amountUsd;
   if(e.type==='DEBIT'){row.totalBilledPkr+=value;row.totalDebitPkr+=value;}else row.totalCreditPkr+=value;
   row.entries.push({statusLabel:e.type==='CREDIT'?(side==='BUY'?'Paid':'Received'):trade.missingFx?'FX unavailable':trade.balanceUsd<=.005?'Paid':trade.entries.some(v=>v.type==='CREDIT')?'Trade partly paid':'Unpaid',settled:e.type==='CREDIT'||(!trade.missingFx&&trade.balanceUsd<=.005),id:e.id,entryDate:new Date(e.date),entryType:e.type,amountPkr:value,billedPkr:value,sourceType:e.sourceType,sourceRef:e.reference,tradeRef:trade.tradeRef,truckId:null,voucherNo:e.voucherNo,dueDate:null,agingBucket:null,saleStage:null,note:e.description,purchaseAdvanceFlow:side==='BUY'});
  }
  accounts.set(key,row);
 }
 for(const r of accounts.values()){r.balancePkr=r.totalCreditPkr-r.totalBilledPkr;r.outstandingDebitPkr=Math.max(0,-r.balancePkr);r.availableCreditPkr=Math.max(0,r.balancePkr);r.aging.current=r.outstandingDebitPkr;r.settledDebitPkr=Math.min(r.totalCreditPkr,r.totalBilledPkr);r.entries.sort((a,b)=>b.entryDate.getTime()-a.entryDate.getTime());}
 if(hideEmpty&&!q.data?.length&&!q.error)return null;
 return <section className="space-y-4"><h1 className="text-xl font-semibold">FZCO counterparty ledgers — USD</h1><p className="text-sm text-subtle">Purchases and sales settle independently. Amounts use the saved exchange rate for each entry.</p>{q.error&&<p role="alert">{q.error.message}</p>}{q.data?.some(t=>t.missingFx)&&<p role="alert">Some historical entries have no exchange rate and are excluded from USD totals until reconciled.</p>}<CounterpartyLedgersPanel currency="USD" enableFilters rows={[...accounts.values()]} isLoading={q.isLoading}/></section>;
}
