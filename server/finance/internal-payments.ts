import {prisma} from '@/server/db';
import type {Prisma} from '@prisma/client';
import {internalEntity,tradeEntity,ENTITY_NAMES,type SesameEntity} from '@/lib/sesame-entity';
import {isSesameCommodity} from '@/lib/sesame';
import {nextSerial,SERIALS} from '@/server/db/serials';
const n=(v:unknown)=>Number(v??0);
export async function entityCounterparty(db:Prisma.TransactionClient,entity:SesameEntity,userId:string){
 const tradingEntities = entity === "PAK" ? ["FZCO"] : ["PAK"];
 return db.counterparty.upsert({
  where:{code:`INTERCO-${entity}`},
  update:{tradingEntities},
  create:{code:`INTERCO-${entity}`,name:ENTITY_NAMES[entity],country:entity==='PAK'?'Pakistan':'United Arab Emirates',type:'TRADING_PARTNER',createdById:userId,tradingEntities},
 });
}
export async function internalPaymentRows(code:string,entity:SesameEntity){
 const trades=(await prisma.trade.findMany({where:{commodity:{code},tradeStatus:{notIn:['CANCELLED']}},include:{contract:true}})).filter(t=>internalEntity(t.tradeParams)&&isSesameCommodity(code));
 const vouchers=await prisma.voucher.findMany({where:{tradeRef:{in:trades.map(t=>t.tradeRef)},internalPaymentRef:{not:null}},orderBy:{createdAt:'desc'}});
 return trades.map(t=>{const side=tradeEntity(t.tradeParams)===entity?t.direction:t.direction==='BUY'?'SELL':'BUY';const fx=n((t.tradeParams as Record<string,unknown>)?.executionFxPkrPerUsd);return {tradeRef:t.tradeRef,side,currency:t.currency,fxRate:fx,quantityMt:n(t.quantity),amountPkr:n(t.quantity)*1000*n(t.contract?.ratePerKg),locked:!!t.contract&&['LOCKED','CONFIRMED','EXECUTED'].includes(t.tradeStatus),payments:vouchers.filter(v=>v.tradeRef===t.tradeRef&&v.executionEntity===entity).map(v=>{const other=vouchers.find(o=>o.tradeRef===t.tradeRef&&o.internalPaymentRef===v.internalPaymentRef&&o.executionEntity!==entity&&o.status!=='REJECTED');const status=v.status==='REJECTED'?'Rejected':!other?'Awaiting counterpart':Math.abs(n(v.amountPkr)-n(other.amountPkr))>.005?'Amount mismatch':v.status==='APPROVED'&&other.status==='APPROVED'?'Reconciled':'Awaiting finance';return {voucherNo:v.voucherNo,reference:v.internalPaymentRef,amountPkr:n(v.amountPkr),status,counterpart:other?.voucherNo??null};})};});
}
export async function createInternalPayment(input:{tradeRef:string;paymentRef:string;amountPkr:number;entity:SesameEntity;actor:string;userId:string;code:string}){
 return prisma.$transaction(async db=>{
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`internal-payment:${input.tradeRef}`}))::text`;
  const t=await db.trade.findUniqueOrThrow({where:{tradeRef:input.tradeRef},include:{commodity:true,contract:true}});
  if(!isSesameCommodity(t.commodity.code)||t.commodity.code!==input.code||!internalEntity(t.tradeParams)||!t.contract||!['LOCKED','CONFIRMED','EXECUTED'].includes(t.tradeStatus))throw new Error('Select a locked internal Sesame trade');
  const side=tradeEntity(t.tradeParams)===input.entity?t.direction:t.direction==='BUY'?'SELL':'BUY';
  const ref=input.paymentRef.trim().toUpperCase();if(!ref||!Number.isFinite(input.amountPkr)||input.amountPkr<=0)throw new Error('Enter a reconciliation reference and positive amount');
  const old=await db.voucher.findFirst({where:{tradeRef:t.tradeRef,executionEntity:input.entity,internalPaymentRef:ref}});if(old){if(n(old.amountPkr)!==input.amountPkr||old.status==='REJECTED')throw new Error('Reference already used; use a new reconciliation reference');return {voucherNo:old.voucherNo};}
  const vouchers=await db.voucher.aggregate({where:{tradeRef:t.tradeRef,executionEntity:input.entity,status:{not:'REJECTED'},internalPaymentRef:{not:null}},_sum:{amountPkr:true}});
  const total=n(t.quantity)*1000*n(t.contract.ratePerKg);if(input.amountPkr+n(vouchers._sum.amountPkr)>total+.005)throw new Error('Voucher exceeds the remaining internal trade amount including pending requests');
  const fx=n((t.tradeParams as Record<string,unknown>)?.executionFxPkrPerUsd);if(input.entity==='FZCO'&&fx<=0)throw new Error('Lock a USD / PKR exchange rate on the trade first');
  const cp=await entityCounterparty(db,input.entity==='PAK'?'FZCO':'PAK',input.userId);const voucherNo=await nextSerial(SERIALS.VOUCHER,db);
  await db.voucher.create({data:{voucherNo,tradeRef:t.tradeRef,internalPaymentRef:ref,executionEntity:input.entity,commodityCode:input.code,counterpartyId:cp.id,side,amountPkr:input.amountPkr,paymentFxRate:fx>0?fx:null,note:`Internal ${side==='BUY'?'payment':'receipt'} · ${ref} · ${t.tradeRef}`,enteredByName:input.actor}});
  return {voucherNo};
 });
}
