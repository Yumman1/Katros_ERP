import type {Prisma} from '@prisma/client';
import {pkeImportSale} from '@/lib/sesame-entity';
import {internalCommitted} from './internal-payments';
const n=(v:unknown)=>Number(v??0);
/** Arrival and cleared payment are independent requirements for PKE settlement. */
export async function pkeArrivalComplete(tx:Prisma.TransactionClient,tradeRef:string){
 const trade=await tx.trade.findUniqueOrThrow({where:{tradeRef},include:{contract:true}});
 const params=trade.tradeParams as Record<string,unknown>|null;
 const fileId=typeof params?.pkePortFileId==='string'?params.pkePortFileId:null;
 const files=await tx.pkeImportFile.findMany({where:fileId?{id:fileId}:{OR:[{purchaseTradeRef:tradeRef},{payload:{path:['references','Dubai sale trade reference'],equals:tradeRef}}]}});
 if(!files.length)return trade.direction==='SELL'&&!fileId;
 const refs=files.map(f=>(f.payload as {references:Record<string,string>}).references);
 const declared=refs.reduce((sum,r)=>sum+n(r['BL quantity MT']),0);
 const approved=files.some(f=>(f.payload as unknown as import('@/lib/pke-import').PkeImportPayload).shipmentReviews?.some(q=>q.kind==='SHORTFALL'&&q.status==='APPROVED'&&Math.abs(q.quantityMt-(n(trade.quantity)-declared))<.000001));
 return refs.every(r=>!!r['Vessel arrival date']&&r['Vessel received MT']!==undefined&&r['Vessel received MT']!==''&&n(r['BL quantity MT'])>0)
  && (fileId!==null||approved||declared+.000001>=n(trade.quantity)-n(trade.contract?.quantityToleranceMt));
}
export async function settlePkeTrade(tx:Prisma.TransactionClient,tradeRef:string){
 const t=await tx.trade.findUniqueOrThrow({where:{tradeRef},include:{commodity:true,contract:true}});
 if(t.commodity.code!=='PKE'||!t.contract||['CANCELLED','REJECTED'].includes(t.tradeStatus))return false;
 const internal=pkeImportSale('PKE',t.direction,t.tradeParams);
 const billed=await tx.counterpartyLedgerEntry.aggregate({where:{tradeRef,side:t.direction,entryType:'DEBIT'},_sum:{amountPkr:true}});
 const total=Math.max(n(t.quantity)*1000*n(t.contract.ratePerKg),n(billed._sum.amountPkr));
 const paid=internal?await internalCommitted(tx,tradeRef,true):n((await tx.voucher.aggregate({where:{tradeRef,side:t.direction,status:'APPROVED',noteRef:null},_sum:{amountPkr:true}}))._sum.amountPkr);
 const close=total>0&&paid+.005>=total&&await pkeArrivalComplete(tx,tradeRef);
 await tx.executionContract.update({where:{tradeRef},data:{closeOnPayment:true,contractStatus:close?'Close':'Open'}});
 await tx.trade.update({where:{tradeRef},data:{tradeStatus:close?'EXECUTED':'LOCKED'}});
 return close;
}
