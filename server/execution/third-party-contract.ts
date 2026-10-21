import type {Prisma} from '@prisma/client';
import {tradeEntity,internalEntity} from '@/lib/sesame-entity';
import {sesameGrade} from '@/lib/sesame-processing';
import {quantityUnitToKg} from '@/lib/unit-conversion';
const n=(v:unknown)=>Number(v??0);
export async function thirdPartySource(db:Prisma.TransactionClient,input:{tradeRef:string;holderId:string;location?:string;code:string;grade:string;quantityKg:number;excludeShipmentId?:string}){
 const t=await db.trade.findUniqueOrThrow({where:{tradeRef:input.tradeRef},include:{commodity:true,contract:true,counterparty:true}});
 if(t.direction!=='BUY'||tradeEntity(t.tradeParams)!=='FZCO'||internalEntity(t.tradeParams)||t.commodity.code!==input.code||t.counterpartyId!==input.holderId||!['LOCKED','CONFIRMED','EXECUTED'].includes(t.tradeStatus)||!t.contract)throw new Error('Select the FZCO purchase from this supplier with the matching commodity and grade');
 if(sesameGrade(t.tradeParams)!==input.grade)throw new Error(`Purchase ${t.tradeRef} is ${sesameGrade(t.tradeParams)} sesame, but the sale requires ${input.grade}. Select a purchase with the same grade.`);
 const used=await db.sesameExportShipment.aggregate({where:{sourcePurchaseTradeRef:t.tradeRef,holderId:input.holderId,status:{not:'REJECTED'},...(input.excludeShipmentId?{id:{not:input.excludeShipmentId}}:{})},_sum:{totalWeightKg:true}});
 const remainingKg=quantityUnitToKg(n(t.contract.contractualQtyMt)+n(t.contract.quantityToleranceMt),t.contract.quantityUnit)-n(used._sum.totalWeightKg);
 if(remainingKg+.001<input.quantityKg)throw new Error('This purchase does not have enough remaining quantity with this supplier');
 const fx=t.currency==='PKR'?1:n((t.tradeParams as Record<string,unknown>)?.executionFxPkrPerUsd);if(fx<=0||n(t.contract.ratePerKg)<=0)throw new Error('Lock the supplier purchase rate and USD exchange rate first');
 return {supplier:t.counterparty.name,ratePerKg:n(t.contract.ratePerKg),fx};
}
