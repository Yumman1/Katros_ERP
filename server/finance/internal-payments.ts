import {prisma} from '@/server/db';
import type {Prisma} from '@prisma/client';
import {internalPakSale,pkeImportSale,internalTrade,deskSide,ENTITY_NAMES,type SesameEntity} from '@/lib/sesame-entity';
import {quantityUnitToKg} from '@/lib/unit-conversion';
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
/** Count a legacy pair once; a shared voucher is always stored on the FZCO BUY side. */
export async function internalCommitted(db: Prisma.TransactionClient, tradeRef: string, approvedOnly = false, excludeId?: string) {
 const rows = await db.voucher.findMany({where:{tradeRef, ...(excludeId ? {id:{not:excludeId}} : {}),
  status: approvedOnly ? 'APPROVED' : {not:'REJECTED'},
  OR:[{internalPaymentRef:{not:null}},{voucherKind:'INTL_PURCHASE',executionEntity:'FZCO',side:'BUY'}]}});
 const groups = new Map<string, number>();
 for (const v of rows) {
  const key = v.internalPaymentRef ?? v.id;
  groups.set(key, Math.max(groups.get(key) ?? 0, n(v.amountPkr)));
 }
 return [...groups.values()].reduce((sum, value) => sum + value, 0);
}
export async function internalPaymentRows(code:string,entity:SesameEntity){
 const trades=(await prisma.trade.findMany({where:{commodity:{code},tradeStatus:{notIn:['CANCELLED']}},include:{contract:true,commodity:true}}))
  .filter(t=>internalTrade(t.commodity.code,t.direction,t.tradeParams));
 return Promise.all(trades.map(async t=>{
  const amountPkr=quantityUnitToKg(n(t.quantity),t.quantityUnit ?? 'MT')*n(t.contract?.ratePerKg);
  const committed=await internalCommitted(prisma,t.tradeRef);
  const paid=await internalCommitted(prisma,t.tradeRef,true);
  return {tradeRef:t.tradeRef,side:deskSide(t.commodity.code,t.direction,t.tradeParams,entity),description:pkeImportSale(t.commodity.code,t.direction,t.tradeParams)?'Dubai sale / Pakistan purchase':'Dubai purchase / Pakistan sale',currency:t.currency,
   fxRate:n((t.tradeParams as Record<string,unknown>)?.executionFxPkrPerUsd), quantityMt:n(t.quantity),amountPkr,
   outstandingPkr:Math.max(0,amountPkr-paid),availablePkr:Math.max(0,amountPkr-committed),
   locked:!!t.contract&&['LOCKED','CONFIRMED','EXECUTED'].includes(t.tradeStatus)};
 }));
}
export async function createInternalPayment(input:{tradeRef:string;requestKey:string;amountPkr:number;entity:SesameEntity;actor:string;userId:string;code:string}){
 return prisma.$transaction(async db=>{
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`internal-payment:${input.tradeRef}`}))::text`;
  const t=await db.trade.findUniqueOrThrow({where:{tradeRef:input.tradeRef},include:{commodity:true,contract:true}});
  if(t.commodity.code!==input.code||!internalTrade(t.commodity.code,t.direction,t.tradeParams)||!t.contract||!['LOCKED','CONFIRMED','EXECUTED'].includes(t.tradeStatus))throw new Error('Select a locked Pakistan–FZCO internal trade');
  if(!Number.isFinite(input.amountPkr)||input.amountPkr<=0)throw new Error('Enter a positive amount');
  const old=await db.voucher.findUnique({where:{id:input.requestKey}});
  if(old){if(old.tradeRef!==t.tradeRef||old.voucherKind!=='INTERNAL_TRADE'||Math.abs(n(old.amountPkr)-input.amountPkr)>.005)throw new Error('Request already used');return {voucherNo:old.voucherNo};}
  const pending=await db.voucher.findFirst({where:{tradeRef:t.tradeRef,status:'PENDING_FINANCE',OR:[{internalPaymentRef:{not:null}},{voucherKind:'INTL_PURCHASE',side:'BUY'}]}});
  if(pending)throw new Error(`${pending.voucherNo} is already awaiting approval for this internal trade. Use that shared voucher; do not generate another on the other desk.`);
  const total=quantityUnitToKg(n(t.quantity),t.quantityUnit??'MT')*n(t.contract.ratePerKg);
  if(input.amountPkr+await internalCommitted(db,t.tradeRef)>total+.005)throw new Error('Voucher exceeds the remaining internal trade amount');
  const fx=n((t.tradeParams as Record<string,unknown>)?.executionFxPkrPerUsd);
  if(t.currency==='USD'&&fx<=0)throw new Error('Lock a USD / PKR exchange rate on the trade first');
  const reverse=pkeImportSale(t.commodity.code,t.direction,t.tradeParams);
  const cp=await entityCounterparty(db,reverse?'FZCO':'PAK',input.userId);
  const voucherNo=await nextSerial(SERIALS.VOUCHER,db);
  await db.voucher.create({data:{id:input.requestKey,voucherNo,tradeRef:t.tradeRef,
   voucherKind:'INTERNAL_TRADE',internalPaymentRef:input.requestKey,executionEntity:reverse?'PAK':'FZCO',commodityCode:input.code,
   counterpartyId:cp.id,side:'BUY',amountPkr:input.amountPkr,paymentFxRate:fx>0?fx:null,
   agreedTradeAmountPkr:total,traderApprovalRequired:true,
   note:`Internal settlement · ${reverse?"Pakistan purchase / Dubai FZCO sale":"Dubai FZCO purchase / Kastros Pakistan sale"} · Prepared from ${ENTITY_NAMES[input.entity]}`,
   enteredByName:input.actor}});
  return {voucherNo};
 });
}
/** Finance settles the shared financial book without fabricating physical deliveries. */
export async function closeInternalSettlement(db:Prisma.TransactionClient,tradeRef:string){
 const t=await db.trade.findUniqueOrThrow({where:{tradeRef},include:{commodity:true,contract:true}});
 if(!internalPakSale(t.commodity.code,t.direction,t.tradeParams)||!t.contract)return;
 const total=quantityUnitToKg(n(t.quantity),t.quantityUnit??'MT')*n(t.contract.ratePerKg);
 if(total<=0||await internalCommitted(db,tradeRef,true)+.005<total)return;
 await db.executionContract.update({where:{tradeRef},data:{contractStatus:'Close'}});
 await db.trade.update({where:{tradeRef},data:{tradeStatus:'EXECUTED'}});
}
