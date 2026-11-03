import type {Prisma} from '@prisma/client';
import {pkeImportSale,tradeEntity} from '@/lib/sesame-entity';
import {internalCommitted} from './internal-payments';
const n=(v:unknown)=>Number(v??0);
/** Goods movement never settles PKE's Dubai financial book. */
export async function settlePkeTrade(tx:Prisma.TransactionClient,tradeRef:string){
 const t=await tx.trade.findUniqueOrThrow({where:{tradeRef},include:{commodity:true,contract:true}});
 if(t.commodity.code!=='PKE'||!t.contract)return false;
 const internal=pkeImportSale('PKE',t.direction,t.tradeParams);
 if(!internal&&tradeEntity(t.tradeParams)!=='FZCO')return false;
 const total=n(t.quantity)*1000*n(t.contract.ratePerKg);
 const paid=internal?await internalCommitted(tx,tradeRef,true):n((await tx.voucher.aggregate({where:{tradeRef,commodityCode:'PKE',executionEntity:'FZCO',side:t.direction,status:'APPROVED'},_sum:{amountPkr:true}}))._sum.amountPkr);
 const close=total>0&&paid+.005>=total;
 await tx.executionContract.update({where:{tradeRef},data:{closeOnPayment:true,contractStatus:close?'Close':'Open'}});
 await tx.trade.update({where:{tradeRef},data:{tradeStatus:close?'EXECUTED':'LOCKED'}});
 return close;
}
