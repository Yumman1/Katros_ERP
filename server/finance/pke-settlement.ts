import type {Prisma} from '@prisma/client';
import {pkeImportSale} from '@/lib/sesame-entity';
import {internalCommitted} from './internal-payments';
const n=(v:unknown)=>Number(v??0);
/** Goods movement never settles PKE's Dubai financial book. */
export async function settlePkeTrade(tx:Prisma.TransactionClient,tradeRef:string){
 const t=await tx.trade.findUniqueOrThrow({where:{tradeRef},include:{commodity:true,contract:true}});
 if(t.commodity.code!=='PKE'||!t.contract)return false;
 const internal=pkeImportSale('PKE',t.direction,t.tradeParams);
 const billed=await tx.counterpartyLedgerEntry.aggregate({where:{tradeRef,side:t.direction,entryType:'DEBIT'},_sum:{amountPkr:true}});
 const total=Math.max(n(t.quantity)*1000*n(t.contract.ratePerKg),n(billed._sum.amountPkr));
 const paid=internal?await internalCommitted(tx,tradeRef,true):n((await tx.voucher.aggregate({where:{tradeRef,side:t.direction,status:'APPROVED',noteRef:null},_sum:{amountPkr:true}}))._sum.amountPkr);
 const close=total>0&&paid+.005>=total;
 await tx.executionContract.update({where:{tradeRef},data:{closeOnPayment:true,contractStatus:close?'Close':'Open'}});
 await tx.trade.update({where:{tradeRef},data:{tradeStatus:close?'EXECUTED':'LOCKED'}});
 return close;
}
