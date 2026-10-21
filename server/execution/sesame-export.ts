import {assertCustody} from './fzco-custody';
import {thirdPartySource} from './third-party-contract';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import {prisma} from '@/server/db';
import {nextSerial,SERIALS} from '@/server/db/serials';
import {isSesameCommodity} from '@/lib/sesame';
import {tradeEntity,internalEntity,internalPakSale,FZCO_NO_PAKISTAN_WAREHOUSE} from '@/lib/sesame-entity';
import {sesameGrade} from '@/lib/sesame-processing';
import {quantityUnitToKg} from '@/lib/unit-conversion';
import {warehouseAllowedForCommodity} from '@/lib/warehouse-eligibility';
import {getCompanyWarehouses} from '@/server/trader-master-data';
import {lockSesameOwnership} from './sesame-stock';
import {sesameGrades} from './sesame-processing';
import {processingAvailability} from './warehouse-processing';
import {releaseFzcoOwnership} from './sesame-ownership';
import {closeOnFullPayment,refreshContract} from './contracts';
const n=(v:unknown)=>Number(v??0);
const money=(v:number)=>Math.round(v*100)/100;
const weight=(v:number)=>Math.round(v*1000)/1000;
const text=z.string().trim().min(1).max(120);
export const exportGateInput=z.object({requestKey:z.string().uuid(),tradeRef:text,warehouseName:text,recordedByName:text,transporterName:z.string().trim().max(120).default(''),transporterPhone:z.string().trim().max(40).default(''),remarks:z.string().trim().max(1000).default(''),containers:z.array(z.object({truckNo:text,containerNo:text,croNo:text,weightKg:z.number().finite().positive().multipleOf(.001).max(1000000)})).min(1).max(100)});
const include={sourcePurchaseTrade:{include:{counterparty:true}},trade:{include:{commodity:true,counterparty:true,contract:true}},fzcoSaleTrade:{include:{counterparty:true,contract:true}},trucks:{orderBy:{createdAt:'asc' as const}},vouchers:true} as const;
export type ExportRow=Prisma.SesameExportShipmentGetPayload<{include:typeof include}>;
/** Triparty: the Pakistan → FZCO internal sale ships straight to FZCO's buyer. */
export type TripartyLink={fzcoSaleTradeRef:string};
function validTrade(t:{direction:string;tradeScope:string;directSettled:boolean;tradeStatus:string;tradeParams?:unknown;commodity:{code:string};contract:{contractStatus:string}|null}, direct=false, triparty=false){
 const open=isSesameCommodity(t.commodity.code)&&!t.directSettled&&['LOCKED','CONFIRMED','EXECUTED'].includes(t.tradeStatus)&&!!t.contract&&(t.contract.contractStatus!=='Close'||(direct&&tradeEntity(t.tradeParams)==='FZCO')||(triparty&&internalPakSale(t.commodity.code,t.direction,t.tradeParams)));
 if(triparty){if(!open||!internalPakSale(t.commodity.code,t.direction,t.tradeParams)||t.tradeScope!=='INTERNATIONAL')throw new Error('Select an open, locked Pakistan → Dubai FZCO internal sale');return;}
 if(internalEntity(t.tradeParams)||(!direct&&t.direction!=='SELL')||(!direct&&t.tradeScope!=='INTERNATIONAL')||(direct&&tradeEntity(t.tradeParams)!=='FZCO')||!open)throw new Error('Select an open, locked international Sesame sale trade');
}
/** FZCO's external sale that a triparty shipment fulfils. */
function validFzcoSale(t:{direction:string;tradeScope:string;directSettled:boolean;tradeStatus:string;tradeParams?:unknown;commodity:{code:string};contract:{contractStatus:string}|null}){
 if(!isSesameCommodity(t.commodity.code)||t.direction!=='SELL'||t.tradeScope!=='INTERNATIONAL'||tradeEntity(t.tradeParams)!=='FZCO'||internalEntity(t.tradeParams)||t.directSettled||!['LOCKED','CONFIRMED','EXECUTED'].includes(t.tradeStatus)||!t.contract||t.contract.contractStatus==='Close')throw new Error('Select an open, locked Dubai FZCO international sale');
}
const tradeInclude={commodity:true,counterparty:true,contract:{include:{warehouseAllocations:true}}} as const;
/** Trades offered at the gate for a triparty gate-out: internal PAK → FZCO sales and FZCO's buyer sales. */
export async function tripartyGateTrades(warehouse?:string){
 const trades=await prisma.trade.findMany({where:{direction:'SELL',tradeScope:'INTERNATIONAL',directSettled:false,tradeStatus:{in:['LOCKED','CONFIRMED','EXECUTED']},contract:{OR:[{contractStatus:'Open'},{closeOnPayment:true,openQtyMt:{gt:0}}]}},include:tradeInclude});
 const sesame=trades.filter(t=>isSesameCommodity(t.commodity.code));
 const internal=sesame.filter(t=>internalPakSale(t.commodity.code,t.direction,t.tradeParams)&&(!warehouse||warehouseAllowedForCommodity(warehouse,t.commodity.code))&&(!warehouse||!t.contract?.warehouseAllocations.length||t.contract.warehouseAllocations.some(a=>a.warehouseName===warehouse)));
 const fzco=sesame.filter(t=>t.contract?.contractStatus==='Open'&&tradeEntity(t.tradeParams)==='FZCO'&&!internalEntity(t.tradeParams)&&internal.some(i=>i.commodity.code===t.commodity.code));
 const view=(t:typeof trades[number])=>({tradeRef:t.tradeRef,counterpartyName:t.counterparty.name,counterpartyCode:t.counterparty.code,counterpartyId:t.counterpartyId,commodityCode:t.commodity.code,commodityName:t.commodity.name,grade:sesameGrade(t.tradeParams),openMt:n(t.contract?.openQtyMt??t.quantity)});
 return {internal:internal.map(view),fzco:fzco.map(view)};
}
function audit(row:{audit:Prisma.JsonValue},actor:string,event:string,details:Record<string,string|number>={}){return [...(Array.isArray(row.audit)?row.audit:[]),{at:new Date().toISOString(),actor,event,...details}] as Prisma.InputJsonValue;}
export function exportView(s:ExportRow){
 const saleVouchers=s.vouchers.filter(v=>v.side==='SELL'&&(v.voucherKind==='INTL_SALE'||!v.voucherKind));
 const received=money(saleVouchers.filter(v=>v.status==='APPROVED').reduce((a,v)=>a+n(v.amountPkr),0));
 const pending=money(saleVouchers.filter(v=>v.status==='PENDING_FINANCE').reduce((a,v)=>a+n(v.amountPkr),0));
 const collectionAmount=s.triparty?n(s.fzcoAmountPkr)||n(s.amountPkr):n(s.amountPkr);
 return {sourcePurchaseTradeRef:s.sourcePurchaseTradeRef,supplier:s.sourcePurchaseTrade?.counterparty.name??null,supplierAmountPkr:n(s.supplierAmountPkr),supplierFxRate:n(s.supplierFxRate),id:s.id,directThirdParty:s.directThirdParty,triparty:s.triparty,fzcoSaleTradeRef:s.fzcoSaleTradeRef,buyer:s.fzcoSaleTrade?.counterparty.name??null,dispatchLocation:s.dispatchLocation,movementDate:s.movementDate,documentLinks:s.documentLinks,side:s.trade.direction,tradeRef:s.tradeRef,warehouseName:s.warehouseName,entity:tradeEntity(s.trade.tradeParams),commodityCode:s.trade.commodity.code,counterparty:s.trade.counterparty.name,status:s.status,revision:s.revision,deliveryOrderNo:s.deliveryOrderNo,gateOutSlipNo:s.gateOutSlipNo,blNo:s.blNo,totalWeightKg:n(s.totalWeightKg),ratePkrPerKg:n(s.ratePkrPerKg),quotedCurrency:s.quotedCurrency,fxRate:n(s.fxRate),fzcoFxRate:n(s.fzcoFxRate),defaultAmountPkr:n(s.defaultAmountPkr),amountPkr:n(s.amountPkr),fzcoAmountPkr:n(s.fzcoAmountPkr),receivedPkr:received,pendingPkr:pending,outstandingPkr:money(Math.max(0,collectionAmount-received)),paid:!!s.blNo&&received+.005>=collectionAmount,createdAt:s.createdAt,releasedAt:s.releasedAt,traderApprovedBy:s.traderApprovedBy,executionApprovedBy:s.executionApprovedBy,financeApprovedBy:s.financeApprovedBy,audit:s.audit,trucks:s.trucks.map(t=>({id:t.id,truckNo:t.truckNo,containerNo:t.containerNo,croNo:t.croNo,weightKg:n(t.weightKg),gatepassNo:t.gatepassNo,releasedAt:t.saleReleasedAt})),vouchers:s.vouchers.map(v=>({id:v.id,voucherNo:v.voucherNo,amountPkr:n(v.amountPkr),status:v.status,reference:v.reference,kind:v.voucherKind,side:v.side}))};
}
export async function exportGateTrades(warehouse?:string){
 const trades=await prisma.trade.findMany({where:{direction:'SELL',tradeScope:'INTERNATIONAL',directSettled:false,tradeStatus:{in:['LOCKED','CONFIRMED','EXECUTED']},contract:{contractStatus:'Open'}},include:{commodity:true,counterparty:true,contract:{include:{warehouseAllocations:true}}}});
 return trades.filter(t=>!internalEntity(t.tradeParams)&&isSesameCommodity(t.commodity.code)&&tradeEntity(t.tradeParams)==='PAK'&&(!warehouse||warehouseAllowedForCommodity(warehouse,t.commodity.code))&&(!warehouse||!t.contract?.warehouseAllocations.length||t.contract.warehouseAllocations.some(a=>a.warehouseName===warehouse))).map(t=>({tradeRef:t.tradeRef,counterpartyName:t.counterparty.name,counterpartyCode:t.counterparty.code,commodityCode:t.commodity.code,commodityName:t.commodity.name,entity:tradeEntity(t.tradeParams)}));
}
const directContainers=z.array(z.object({truckNo:text,containerNo:z.string().trim().max(120).default(''),croNo:z.string().trim().max(120).default(''),weightKg:z.number().finite().positive().multipleOf(.001).max(1000000)})).min(1).max(100);
export const directGateInput=exportGateInput.omit({warehouseName:true,recordedByName:true}).extend({containers:directContainers,holderId:z.string().min(1),dispatchLocation:z.string().trim().max(120).default(''),movementDate:z.coerce.date(),documentLinks:z.array(z.string().url().max(2000).refine(v=>v.startsWith("https://"),"Use HTTPS document links")).max(20).default([])});
export async function addExportContainers(raw:z.infer<typeof exportGateInput>, direct?:{sourcePurchaseTradeRef?:string;holderId:string;dispatchLocation:string;movementDate:Date;documentLinks:string[]}, transaction?:Prisma.TransactionClient, gatepassNumbers?:string[], triparty?:TripartyLink){
 const input=(direct?exportGateInput.extend({containers:directContainers}):exportGateInput).parse(raw);const hash=createHash('sha256').update(JSON.stringify({input,direct:direct?{sourcePurchaseTradeRef:direct.sourcePurchaseTradeRef??null,holderId:direct.holderId,dispatchLocation:direct.dispatchLocation,movementDate:direct.movementDate,documentLinks:direct.documentLinks}:null,triparty:triparty?.fzcoSaleTradeRef??null})).digest('hex');
 const warehouses=direct||transaction?[]:await getCompanyWarehouses();if(!direct&&!transaction&&!warehouses.some(w=>w.name===input.warehouseName))throw new Error('Select a company warehouse');
 const run=async (db:Prisma.TransactionClient)=>{
  const trade=await db.trade.findUniqueOrThrow({where:{tradeRef:input.tradeRef},include:{commodity:true,counterparty:true,contract:{include:{warehouseAllocations:true}}}});validTrade(trade,!!direct,!!triparty);
  const code=trade.commodity.code,entity=tradeEntity(trade.tradeParams);if(!direct&&!warehouseAllowedForCommodity(input.warehouseName,code))throw new Error('Warehouse is not allocated to Sesame');
  await lockSesameOwnership(db,code);
  const old=await db.sesameExportSubmission.findUnique({where:{id:input.requestKey},include:{shipment:{include}}});
  if(old){if(old.payloadHash!==hash)throw new Error('Request key already used for different entries');return exportView(old.shipment);}
  const grade=sesameGrade(trade.tradeParams),c=trade.contract!;
  if(direct&&trade.currency!=='USD')throw new Error('FZCO direct movements require a USD trade');
  const total=weight(input.containers.reduce((a,t)=>a+t.weightKg,0));
  // Triparty: the same containers also fulfil FZCO's sale to the final buyer.
  let fzcoSale:Prisma.TradeGetPayload<{include:typeof tradeInclude}>|null=null;
  if(triparty){
   fzcoSale=await db.trade.findUniqueOrThrow({where:{tradeRef:triparty.fzcoSaleTradeRef},include:tradeInclude});validFzcoSale(fzcoSale);
   if(fzcoSale.commodity.code!==code)throw new Error('FZCO sale must be for the same commodity');
   if(sesameGrade(fzcoSale.tradeParams)!==grade)throw new Error('FZCO sale grade must match the internal sale grade');
   const shipped=await db.sesameExportShipment.aggregate({where:{fzcoSaleTradeRef:fzcoSale.tradeRef,triparty:true,status:{not:'REJECTED'}},_sum:{totalWeightKg:true}});
   const fc=fzcoSale.contract!;
   if(n(shipped._sum.totalWeightKg)+total>quantityUnitToKg(n(fc.contractualQtyMt)+n(fc.quantityToleranceMt),fc.quantityUnit)+.001)throw new Error('Shipment exceeds the remaining FZCO sale quantity');
  }
  const allocated=await db.outboundDispatch.aggregate({where:{tradeRef:trade.tradeRef},_sum:{allocatedQtyMt:true}});
  const directAllocated=await db.sesameExportShipment.aggregate({where:{OR:[{tradeRef:trade.tradeRef,directThirdParty:true},{fzcoSaleTradeRef:trade.tradeRef,triparty:true}]},_sum:{totalWeightKg:true}});
  if(n(allocated._sum.allocatedQtyMt)*1000+n(directAllocated._sum.totalWeightKg)+total>quantityUnitToKg(n(c.contractualQtyMt)+n(c.quantityToleranceMt),c.quantityUnit)+.001)throw new Error('Shipment exceeds remaining trade quantity');
  if(!direct&&entity==='PAK'&&c.warehouseAllocations.length){const a=c.warehouseAllocations.find(a=>a.warehouseName===input.warehouseName);if(!a)throw new Error('Warehouse is not allocated to this trade');const used=await db.outboundDispatch.aggregate({where:{tradeRef:trade.tradeRef,warehouseName:input.warehouseName},_sum:{allocatedQtyMt:true}});if(n(used._sum.allocatedQtyMt)*1000+total>quantityUnitToKg(n(a.qtyMt),c.quantityUnit)+.001)throw new Error('Shipment exceeds the trade warehouse allocation');}
  if(direct)await db.counterparty.findUniqueOrThrow({where:{id:direct.holderId}});
  if(direct&&trade.direction==='SELL'){if(!direct.sourcePurchaseTradeRef)throw new Error('Select the supplier purchase for this triparty contract');}
  if(!direct&&entity==='FZCO')throw new Error(FZCO_NO_PAKISTAN_WAREHOUSE);
  if(!direct&&entity==='PAK'){
   const available=await processingAvailability(db,code,input.warehouseName,grade,trade.tradeRef);if(total>available.availableKg+.001)throw new Error(`Insufficient ${grade} at ${input.warehouseName} (${(available.availableKg/1000).toFixed(3)} MT free after open sales and processing)`);
  }
  const source=direct?.sourcePurchaseTradeRef?await thirdPartySource(db,{tradeRef:direct.sourcePurchaseTradeRef,holderId:direct.holderId,location:direct.dispatchLocation,code,grade,quantityKg:total}):null;
  if(source&&trade.direction!=='SELL')throw new Error('Triparty dispatch requires a sale to the final buyer');
  if(direct&&trade.direction==='SELL')await assertCustody(db,code,grade,total/1000,{holderId:direct.holderId});
  let group=await db.sesameExportShipment.findFirst({where:{sourcePurchaseTradeRef:direct?.sourcePurchaseTradeRef??null,tradeRef:trade.tradeRef,warehouseName:input.warehouseName,directThirdParty:!!direct,triparty:!!triparty,fzcoSaleTradeRef:triparty?.fzcoSaleTradeRef??null,status:'DRAFT'}});
  const rate=n(c.ratePerKg);if(rate<=0)throw new Error('The locked trade needs a valid settlement rate');
  const params=trade.tradeParams as Record<string,unknown>|null;const fx=trade.currency==='PKR'?1:n(params?.executionFxPkrPerUsd);if(!['PKR','USD'].includes(trade.currency)||fx<=0)throw new Error('Lock a valid exchange rate for this trade first');
  if(fzcoSale){const fp=fzcoSale.tradeParams as Record<string,unknown>|null;if(n(fzcoSale.contract?.ratePerKg)<=0||(fzcoSale.currency!=='PKR'&&n(fp?.executionFxPkrPerUsd)<=0))throw new Error('Lock a valid rate and exchange rate on the FZCO sale first');}
  if(!group)group=await db.sesameExportShipment.create({data:{sourcePurchaseTradeRef:direct?.sourcePurchaseTradeRef,supplierFxRate:source?.fx,tradeRef:trade.tradeRef,warehouseName:input.warehouseName,directThirdParty:!!direct,triparty:!!triparty,fzcoSaleTradeRef:triparty?.fzcoSaleTradeRef??null,holderId:direct?.holderId,dispatchLocation:direct?.dispatchLocation,movementDate:direct?.movementDate,documentLinks:direct?.documentLinks??[],totalWeightKg:0,ratePkrPerKg:rate,quotedCurrency:trade.currency,fxRate:fx,defaultAmountPkr:0,amountPkr:0,createdBy:input.recordedByName}});
  if(group.directThirdParty&&(group.holderId!==direct?.holderId))throw new Error('Finish the open shipment before changing the stock holder');
  const numbers=input.containers.map(t=>t.containerNo.toUpperCase()).filter(Boolean);if(new Set(numbers).size!==numbers.length)throw new Error('Container numbers must be unique within the shipment');
  if(await db.pendingTruck.count({where:{exportShipment:{tradeRef:trade.tradeRef},containerNo:{in:numbers}}}))throw new Error('This container is already recorded against this trade');
  for(const [index,item] of input.containers.entries()){
   const gatepassNo=gatepassNumbers?.[index]??await nextSerial(SERIALS.GATEPASS_OUTBOUND,db);
   const truck=await db.pendingTruck.create({data:{exportShipmentId:group.id,containerNo:item.containerNo.toUpperCase()||null,croNo:item.croNo||null,truckNo:item.truckNo.toUpperCase(),gatepassNo,arrivalDate:direct?.movementDate??new Date(),movementType:trade.direction==='BUY'?'INBOUND':'OUTBOUND',status:'ASSIGNED',warehouseName:direct?'':input.warehouseName,counterpartyName:trade.counterparty.name,commodityCode:code,commodityName:trade.commodity.name,executionEntity:entity,recordedByName:input.recordedByName,transporterName:input.transporterName,transporterPhone:input.transporterPhone,remarks:fzcoSale?[`Triparty · FZCO sale ${fzcoSale.tradeRef} · buyer ${fzcoSale.counterparty.name}`,input.remarks].filter(Boolean).join(' · '):input.remarks,builtyDetails:item.croNo,weightKg:item.weightKg,weightAsPerBuiltyKg:item.weightKg,remainingKg:0,assignedTradeRef:trade.tradeRef,assignedAt:new Date()}});
   if(!direct)await db.outboundDispatch.create({data:{gatepassNo,tradeRef:trade.tradeRef,dispatchDate:new Date(),liftedBy:input.transporterName||input.recordedByName,buyerName:trade.counterparty.name,warehouseName:input.warehouseName,truckNo:truck.truckNo,dispatchWeightKg:item.weightKg,invoiceWeightKg:item.weightKg,fungusPct:0,doRef:gatepassNo,allocatedQtyMt:item.weightKg/1000,amountDue:money(item.weightKg*rate),status:'AT_GATE'}});
  }
  const newWeight=weight(n(group.totalWeightKg)+total),amount=money(newWeight*n(group.ratePkrPerKg));
  await db.sesameExportShipment.update({where:{id:group.id},data:{...(direct?{documentLinks:[...new Set([...(Array.isArray(group.documentLinks)?group.documentLinks.filter((v):v is string=>typeof v==="string"):[]),...direct.documentLinks])]}:{}),supplierAmountPkr:source?money(newWeight*source.ratePerKg):undefined,totalWeightKg:newWeight,defaultAmountPkr:amount,amountPkr:amount,revision:{increment:1},audit:audit(group,input.recordedByName,'Containers added',{weightKg:total})}});
  await db.sesameExportSubmission.create({data:{id:input.requestKey,shipmentId:group.id,payloadHash:hash}});
  return exportView(await db.sesameExportShipment.findUniqueOrThrow({where:{id:group.id},include}));
 };
 return transaction?run(transaction):prisma.$transaction(run,{timeout:30000});
}
export async function exportRows(){return prisma.sesameExportShipment.findMany({include,orderBy:{createdAt:'desc'}});}
export async function exportAction(id:string,revision:number,actor:string,action:'generate'|'trader'|'execution'|'finance'|'reject'|'release'|'bl'|'adjust',value?:{blNo?:string;amountPkr?:number;reason?:string;expectedStage?:string}){
 const result=await prisma.$transaction(async db=>{
  const initial=await db.sesameExportShipment.findUniqueOrThrow({where:{id},include});
  await lockSesameOwnership(db,initial.trade.commodity.code);
  if(action==='adjust')await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`export-receipt:${id}`}))::text`;
  const s=await db.sesameExportShipment.findUniqueOrThrow({where:{id},include});
  if(s.revision!==revision)throw new Error('Shipment changed. Refresh and try again');
  const requireStage=(stage:string)=>{if(s.status!==stage)throw new Error('Shipment is not ready for this action');};
  const data:Prisma.SesameExportShipmentUpdateInput={revision:{increment:1},audit:audit(s,actor,action,value?.reason?{reason:value.reason}:{})};
  if(action==='generate'){if(!['DRAFT','REJECTED'].includes(s.status))throw new Error('Shipment is not ready for a DO');validTrade(s.trade,s.directThirdParty,s.triparty);if(s.triparty&&s.fzcoSaleTrade)validFzcoSale({...s.fzcoSaleTrade,commodity:s.trade.commodity});if(!s.trucks.length)throw new Error('Add containers first');data.deliveryOrderNo=await nextSerial(SERIALS.DELIVERY_ORDER,db);data.status='TRADER_PENDING';}
  if(action==='trader'){requireStage('TRADER_PENDING');data.traderApprovedBy=actor;data.status='EXECUTION_PENDING';}
  if(action==='execution'){requireStage('EXECUTION_PENDING');data.executionApprovedBy=actor;data.status='FINANCE_PENDING';}
  if(action==='finance'){requireStage('FINANCE_PENDING');data.financeApprovedBy=actor;data.status='APPROVED';data.gateOutSlipNo=await nextSerial(SERIALS.GATE_OUT_SLIP,db);}
  if(action==='reject'){requireStage(value!.expectedStage!);if(!value?.reason?.trim())throw new Error('Enter a rejection reason');data.status='REJECTED';data.audit=audit(s,actor,'DO rejected',{reason:value.reason,voidDo:s.deliveryOrderNo??''});data.deliveryOrderNo=null;data.traderApprovedBy=null;data.executionApprovedBy=null;data.financeApprovedBy=null;}
  if(action==='release'){
   requireStage('APPROVED');if(!s.gateOutSlipNo)throw new Error('Approved gate-out slip required');
   const grade=sesameGrade(s.trade.tradeParams);const stock=(await sesameGrades(db,s.trade.commodity.code)).find(w=>w.name===s.warehouseName)?.grades[grade]??0;
   if(!s.directThirdParty&&n(s.totalWeightKg)>stock*1000+.001)throw new Error('Physical grade stock no longer covers this shipment');
   if(s.directThirdParty){
    if(s.sourcePurchaseTradeRef)await thirdPartySource(db,{tradeRef:s.sourcePurchaseTradeRef,holderId:s.holderId!,location:s.dispatchLocation!,code:s.trade.commodity.code,grade,quantityKg:n(s.totalWeightKg),excludeShipmentId:s.id});
    if(!s.holderId)throw new Error('Record the third-party holder before releasing this shipment');
    if(s.trade.direction==='SELL'&&s.sourcePurchaseTradeRef)await assertCustody(db,s.trade.commodity.code,grade,n(s.totalWeightKg)/1000,{holderId:s.holderId},true);
   }
   for(const t of s.trucks){if(t.saleReleasedAt)throw new Error('Container already released');if(!s.directThirdParty&&t.executionEntity==='FZCO')await releaseFzcoOwnership(db,t.id,actor);await db.pendingTruck.update({where:{id:t.id},data:{saleReleasedAt:new Date(),saleReleasedBy:actor}});await db.outboundDispatch.updateMany({where:{gatepassNo:t.gatepassNo,status:'AT_GATE'},data:{status:'RELEASED',doRef:s.deliveryOrderNo!,dispatchDate:new Date()}});}
   data.status='RELEASED';data.releasedAt=new Date();
  }
  if(action==='bl'){
   requireStage('RELEASED');const blNo=value?.blNo?.trim().toUpperCase();if(!blNo)throw new Error('Enter BL number after loading onto the vessel');if(await db.sesameExportShipment.findUnique({where:{blNo}}))throw new Error('This BL already belongs to another DO');data.blNo=blNo;data.blRecordedAt=new Date();data.status='BL_RECORDED';
   if(s.triparty){
    const fzcoSale=s.fzcoSaleTrade;if(!fzcoSale)throw new Error('Assign the Dubai FZCO sale before recording the BL');
    const {entityCounterparty}=await import('@/server/finance/internal-payments');
    const pakSeesFzco=await entityCounterparty(db,'FZCO',s.trade.createdById);
    const fzcoSeesPak=await entityCounterparty(db,'PAK',s.trade.createdById);
    const fzcoParams=fzcoSale.tradeParams as Record<string,unknown>|null;
    const fzcoFx=fzcoSale.currency==='PKR'?1:n(fzcoParams?.executionFxPkrPerUsd);if(fzcoFx<=0)throw new Error('Lock a USD / PKR exchange rate on the FZCO sale first');
    const fzcoAmount=money(n(s.totalWeightKg)*n(fzcoSale.contract?.ratePerKg));
    data.fzcoAmountPkr=fzcoAmount;data.fzcoFxRate=fzcoFx;
    await db.counterpartyLedgerEntry.create({data:{exportShipmentId:id,executionEntity:'PAK',paymentFxRate:s.fxRate,counterpartyId:pakSeesFzco.id,tradeRef:s.tradeRef,side:'SELL',entryType:'DEBIT',sourceType:'INVOICE',sourceRef:blNo,amountPkr:s.amountPkr,note:`Internal sale BL ${blNo} · DO ${s.deliveryOrderNo} · ${s.totalWeightKg} kg`}});
    await db.counterpartyLedgerEntry.create({data:{exportShipmentId:id,executionEntity:'FZCO',paymentFxRate:s.fxRate,counterpartyId:fzcoSeesPak.id,tradeRef:s.tradeRef,side:'BUY',entryType:'DEBIT',sourceType:'INVOICE',sourceRef:blNo,amountPkr:s.amountPkr,note:`Internal purchase BL ${blNo} · DO ${s.deliveryOrderNo} · ${s.totalWeightKg} kg`}});
    await db.counterpartyLedgerEntry.create({data:{exportShipmentId:id,executionEntity:'FZCO',paymentFxRate:fzcoFx,counterpartyId:fzcoSale.counterpartyId,tradeRef:fzcoSale.tradeRef,side:'SELL',entryType:'DEBIT',sourceType:'INVOICE',sourceRef:blNo,amountPkr:fzcoAmount,note:`Sesame export BL ${blNo} · DO ${s.deliveryOrderNo} · ${s.totalWeightKg} kg · FZCO sale ${fzcoSale.tradeRef}`}});
   }else{
    await db.counterpartyLedgerEntry.create({data:{exportShipmentId:id,executionEntity:tradeEntity(s.trade.tradeParams),paymentFxRate:s.fxRate,counterpartyId:s.trade.counterpartyId,tradeRef:s.tradeRef,side:s.trade.direction,entryType:'DEBIT',sourceType:'INVOICE',sourceRef:blNo,amountPkr:s.amountPkr,note:`Sesame export BL ${blNo} · DO ${s.deliveryOrderNo} · ${s.totalWeightKg} kg`}});
   }
  }
  if(action==='adjust'){
   requireStage('BL_RECORDED');if(!value?.reason?.trim()||!value.amountPkr||!Number.isFinite(value.amountPkr)||value.amountPkr<=0)throw new Error('Enter a positive final amount and adjustment reason');
   if(s.vouchers.some(v=>v.status!=='REJECTED'))throw new Error('Resolve vouchers before adjusting the BL amount');
   data.amountPkr=money(value.amountPkr);data.audit=audit(s,actor,'BL amount adjusted',{oldAmountPkr:n(s.amountPkr),amountPkr:money(value.amountPkr),reason:value.reason});
   await db.counterpartyLedgerEntry.updateMany({where:{exportShipmentId:id,tradeRef:s.tradeRef},data:{amountPkr:money(value.amountPkr),note:`BL ${s.blNo} · DO ${s.deliveryOrderNo} · Adjusted by ${actor}: ${value.reason}`}});
  }
  return exportView(await db.sesameExportShipment.update({where:{id},data,include}));
 },{timeout:30000});
 if(action==='release')await refreshContract(result.tradeRef);
 if(action==='bl'){
  if(result.fzcoSaleTradeRef)await refreshContract(result.fzcoSaleTradeRef);
  await closeOnFullPayment(result.tradeRef);
  if(result.fzcoSaleTradeRef)await closeOnFullPayment(result.fzcoSaleTradeRef);
 }
 return result;
}
export async function exportReceipt(id:string,actor:string,input:{amountPkr:number;method:string;reference:string;bankName?:string;requestKey:string}){
 return prisma.$transaction(async db=>{
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`export-receipt:${id}`}))::text`;
  const s=await db.sesameExportShipment.findUniqueOrThrow({where:{id},include});if(s.status!=='BL_RECORDED'||!s.blNo)throw new Error('Record the BL before collecting payment');
  const sale=s.triparty?s.fzcoSaleTrade:s.trade;if(!sale)throw new Error('Assign the sale trade before collecting payment');
  const cap=s.triparty?n(s.fzcoAmountPkr):n(s.amountPkr);
  const side=s.triparty?'SELL':s.trade.direction;
  const entity=s.triparty?'FZCO':tradeEntity(s.trade.tradeParams);
  const old=await db.voucher.findUnique({where:{id:input.requestKey}});if(old){if(old.exportShipmentId!==id||n(old.amountPkr)!==input.amountPkr||old.reference!==input.reference.trim())throw new Error('Request already used');return {voucherNo:old.voucherNo};}
  const committed=s.vouchers.filter(v=>v.status!=='REJECTED'&&v.side===side).reduce((a,v)=>a+n(v.amountPkr),0);if(input.amountPkr>cap-committed+.005)throw new Error('Receipt exceeds the remaining BL balance including pending vouchers');
  if(side==='SELL'&&!input.reference.trim())throw new Error('Enter payment reference');if(side==='SELL'&&input.method==='Bank transfer'&&!input.bankName?.trim())throw new Error('Enter bank name');
  const voucherNo=await nextSerial(SERIALS.VOUCHER,db);
  await db.voucher.create({data:{id:input.requestKey,exportShipmentId:id,voucherKind:side==='SELL'?'INTL_SALE':'INTL_PURCHASE',voucherNo,counterpartyId:sale.counterpartyId,tradeRef:sale.tradeRef,commodityCode:s.trade.commodity.code,executionEntity:entity,side,amountPkr:input.amountPkr,paymentFxRate:s.triparty?n(s.fzcoFxRate??s.fxRate):s.fxRate,method:input.method,reference:side==='BUY'?null:input.reference.trim(),bankName:input.bankName?.trim(),note:`BL ${s.blNo} · DO ${s.deliveryOrderNo} · ${s.totalWeightKg} kg`,enteredByName:actor}});
  return {voucherNo};
 });
}
