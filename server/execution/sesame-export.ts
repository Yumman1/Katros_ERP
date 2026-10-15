import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import {prisma} from '@/server/db';
import {nextSerial,SERIALS} from '@/server/db/serials';
import {isSesameCommodity} from '@/lib/sesame';
import {tradeEntity,internalEntity} from '@/lib/sesame-entity';
import {sesameGrade} from '@/lib/sesame-processing';
import {quantityUnitToKg} from '@/lib/unit-conversion';
import {warehouseAllowedForCommodity} from '@/lib/warehouse-eligibility';
import {getCompanyWarehouses} from '@/server/trader-master-data';
import {lockSesameOwnership} from './sesame-stock';
import {sesameGrades} from './sesame-processing';
import {processingReservedKg} from './processing-reservations';
import {processingAvailability} from './warehouse-processing';
import {releaseFzcoOwnership} from './sesame-ownership';
import {refreshContract} from './contracts';
const n=(v:unknown)=>Number(v??0);
const money=(v:number)=>Math.round(v*100)/100;
const weight=(v:number)=>Math.round(v*1000)/1000;
const text=z.string().trim().min(1).max(120);
export const exportGateInput=z.object({requestKey:z.string().uuid(),tradeRef:text,warehouseName:text,recordedByName:text,transporterName:z.string().trim().max(120).default(''),transporterPhone:z.string().trim().max(40).default(''),remarks:z.string().trim().max(1000).default(''),containers:z.array(z.object({truckNo:text,containerNo:text,croNo:text,weightKg:z.number().finite().positive().multipleOf(.001).max(1000000)})).min(1).max(100)});
const include={trade:{include:{commodity:true,counterparty:true,contract:true}},trucks:{orderBy:{createdAt:'asc' as const}},vouchers:true} as const;
export type ExportRow=Prisma.SesameExportShipmentGetPayload<{include:typeof include}>;
function validTrade(t:{direction:string;tradeScope:string;directSettled:boolean;tradeStatus:string;tradeParams?:unknown;commodity:{code:string};contract:{contractStatus:string}|null}, direct=false){
 if(internalEntity(t.tradeParams)||(!direct&&t.direction!=='SELL')||(!direct&&t.tradeScope!=='INTERNATIONAL')||(direct&&tradeEntity(t.tradeParams)!=='FZCO')||!isSesameCommodity(t.commodity.code)||t.directSettled||!['LOCKED','CONFIRMED','EXECUTED'].includes(t.tradeStatus)||!t.contract||t.contract.contractStatus==='Close')throw new Error('Select an open, locked international Sesame sale trade');
}
function audit(row:{audit:Prisma.JsonValue},actor:string,event:string,details:Record<string,string|number>={}){return [...(Array.isArray(row.audit)?row.audit:[]),{at:new Date().toISOString(),actor,event,...details}] as Prisma.InputJsonValue;}
export function exportView(s:ExportRow){
 const received=money(s.vouchers.filter(v=>v.status==='APPROVED').reduce((a,v)=>a+n(v.amountPkr),0));
 const pending=money(s.vouchers.filter(v=>v.status==='PENDING_FINANCE').reduce((a,v)=>a+n(v.amountPkr),0));
 return {id:s.id,directThirdParty:s.directThirdParty,dispatchLocation:s.dispatchLocation,movementDate:s.movementDate,documentLinks:s.documentLinks,side:s.trade.direction,tradeRef:s.tradeRef,warehouseName:s.warehouseName,entity:tradeEntity(s.trade.tradeParams),commodityCode:s.trade.commodity.code,counterparty:s.trade.counterparty.name,status:s.status,revision:s.revision,deliveryOrderNo:s.deliveryOrderNo,gateOutSlipNo:s.gateOutSlipNo,blNo:s.blNo,totalWeightKg:n(s.totalWeightKg),ratePkrPerKg:n(s.ratePkrPerKg),quotedCurrency:s.quotedCurrency,fxRate:n(s.fxRate),defaultAmountPkr:n(s.defaultAmountPkr),amountPkr:n(s.amountPkr),receivedPkr:received,pendingPkr:pending,outstandingPkr:money(Math.max(0,n(s.amountPkr)-received)),paid:!!s.blNo&&received+.005>=n(s.amountPkr),createdAt:s.createdAt,releasedAt:s.releasedAt,traderApprovedBy:s.traderApprovedBy,executionApprovedBy:s.executionApprovedBy,financeApprovedBy:s.financeApprovedBy,audit:s.audit,trucks:s.trucks.map(t=>({id:t.id,truckNo:t.truckNo,containerNo:t.containerNo,croNo:t.croNo,weightKg:n(t.weightKg),gatepassNo:t.gatepassNo,releasedAt:t.saleReleasedAt})),vouchers:s.vouchers.map(v=>({id:v.id,voucherNo:v.voucherNo,amountPkr:n(v.amountPkr),status:v.status,reference:v.reference}))};
}
export async function exportGateTrades(warehouse?:string){
 const trades=await prisma.trade.findMany({where:{direction:'SELL',tradeScope:'INTERNATIONAL',directSettled:false,tradeStatus:{in:['LOCKED','CONFIRMED','EXECUTED']},contract:{contractStatus:'Open'}},include:{commodity:true,counterparty:true,contract:{include:{warehouseAllocations:true}}}});
 return trades.filter(t=>!internalEntity(t.tradeParams)&&isSesameCommodity(t.commodity.code)&&(!warehouse||warehouseAllowedForCommodity(warehouse,t.commodity.code))&&(!warehouse||!t.contract?.warehouseAllocations.length||tradeEntity(t.tradeParams)==='FZCO'||t.contract.warehouseAllocations.some(a=>a.warehouseName===warehouse))).map(t=>({tradeRef:t.tradeRef,counterpartyName:t.counterparty.name,counterpartyCode:t.counterparty.code,commodityCode:t.commodity.code,commodityName:t.commodity.name,entity:tradeEntity(t.tradeParams)}));
}
const directContainers=z.array(z.object({truckNo:text,containerNo:z.string().trim().max(120).default(''),croNo:z.string().trim().max(120).default(''),weightKg:z.number().finite().positive().multipleOf(.001).max(1000000)})).min(1).max(100);
export const directGateInput=exportGateInput.omit({warehouseName:true,recordedByName:true}).extend({containers:directContainers,dispatchLocation:text,movementDate:z.coerce.date(),documentLinks:z.array(z.string().url().max(2000).refine(v=>v.startsWith("https://"),"Use HTTPS document links")).max(20).default([])});
export async function addExportContainers(raw:z.infer<typeof exportGateInput>, direct?:{dispatchLocation:string;movementDate:Date;documentLinks:string[]}, transaction?:Prisma.TransactionClient, gatepassNumbers?:string[]){
 const input=(direct?exportGateInput.extend({containers:directContainers}):exportGateInput).parse(raw);const hash=createHash('sha256').update(JSON.stringify({input,direct:direct?{dispatchLocation:direct.dispatchLocation,movementDate:direct.movementDate,documentLinks:direct.documentLinks}:null})).digest('hex');
 const warehouses=direct||transaction?[]:await getCompanyWarehouses();if(!direct&&!transaction&&!warehouses.some(w=>w.name===input.warehouseName))throw new Error('Select a company warehouse');
 const run=async (db:Prisma.TransactionClient)=>{
  const trade=await db.trade.findUniqueOrThrow({where:{tradeRef:input.tradeRef},include:{commodity:true,counterparty:true,contract:{include:{warehouseAllocations:true}}}});validTrade(trade,!!direct);
  const code=trade.commodity.code,entity=tradeEntity(trade.tradeParams);if(!direct&&!warehouseAllowedForCommodity(input.warehouseName,code))throw new Error('Warehouse is not allocated to Sesame');
  await lockSesameOwnership(db,code);
  const old=await db.sesameExportSubmission.findUnique({where:{id:input.requestKey},include:{shipment:{include}}});
  if(old){if(old.payloadHash!==hash)throw new Error('Request key already used for different entries');return exportView(old.shipment);}
  const grade=sesameGrade(trade.tradeParams),c=trade.contract!;
  if(direct&&trade.currency!=='USD')throw new Error('FZCO direct movements require a USD trade');
  const total=weight(input.containers.reduce((a,t)=>a+t.weightKg,0));
  const allocated=await db.outboundDispatch.aggregate({where:{tradeRef:trade.tradeRef},_sum:{allocatedQtyMt:true}});
  const directAllocated=await db.sesameExportShipment.aggregate({where:{tradeRef:trade.tradeRef,directThirdParty:true},_sum:{totalWeightKg:true}});
  const ownership=trade.direction==='BUY'?await db.sesameOwnershipEntry.aggregate({where:{tradeRef:trade.tradeRef,truckId:null},_sum:{quantityMt:true}}):null;
  if(n(allocated._sum.allocatedQtyMt)*1000+n(directAllocated._sum.totalWeightKg)+n(ownership?._sum.quantityMt)*1000+total>quantityUnitToKg(n(c.contractualQtyMt)+n(c.quantityToleranceMt),c.quantityUnit)+.001)throw new Error('Shipment exceeds remaining trade quantity');
  if(!direct&&entity==='PAK'&&c.warehouseAllocations.length){const a=c.warehouseAllocations.find(a=>a.warehouseName===input.warehouseName);if(!a)throw new Error('Warehouse is not allocated to this trade');const used=await db.outboundDispatch.aggregate({where:{tradeRef:trade.tradeRef,warehouseName:input.warehouseName},_sum:{allocatedQtyMt:true}});if(n(used._sum.allocatedQtyMt)*1000+total>quantityUnitToKg(n(a.qtyMt),c.quantityUnit)+.001)throw new Error('Shipment exceeds the trade warehouse allocation');}
  if(!direct&&entity==='PAK'){
   const available=await processingAvailability(db,code,input.warehouseName,grade,trade.tradeRef);if(total>available.availableKg+.001)throw new Error('Insufficient unreserved Pakistan-owned stock');
  }else if(!direct){
   const entries=await db.sesameOwnershipEntry.findMany({where:{commodityCode:code,warehouseName:input.warehouseName},include:{trade:{select:{tradeParams:true}}}});
   const custody=entries.filter(e=>sesameGrade(e.trade.tradeParams)===grade).reduce((a,e)=>a+(e.toEntity==='FZCO'?n(e.quantityMt)*1000:0)-(e.fromEntity==='FZCO'?n(e.quantityMt)*1000:0),0);
   const reserved=await db.outboundDispatch.findMany({where:{warehouseName:input.warehouseName,status:'AT_GATE',trade:{commodity:{code}}},include:{trade:{select:{tradeParams:true}}}});
   const fzcoReserved=reserved.filter(r=>tradeEntity(r.trade.tradeParams)==='FZCO'&&sesameGrade(r.trade.tradeParams)===grade).reduce((a,r)=>a+n(r.allocatedQtyMt)*1000,0);
   const stock=(await sesameGrades(db,code)).find(w=>w.name===input.warehouseName)?.grades[grade]??0;
   const allReserved=reserved.filter(r=>sesameGrade(r.trade.tradeParams)===grade).reduce((a,r)=>a+n(r.allocatedQtyMt)*1000,0);
   if(total>custody-fzcoReserved+.001||total>stock*1000-allReserved-await processingReservedKg(db,code,input.warehouseName,grade)+.001)throw new Error('Insufficient unreserved FZCO-owned grade stock at this warehouse');
  }
  let group=await db.sesameExportShipment.findFirst({where:{tradeRef:trade.tradeRef,warehouseName:input.warehouseName,directThirdParty:!!direct,status:'DRAFT'}});
  const rate=n(c.ratePerKg);if(rate<=0)throw new Error('The locked trade needs a valid settlement rate');
  const params=trade.tradeParams as Record<string,unknown>|null;const fx=trade.currency==='PKR'?1:n(params?.executionFxPkrPerUsd);if(!['PKR','USD'].includes(trade.currency)||fx<=0)throw new Error('Lock a valid exchange rate for this trade first');
  if(!group)group=await db.sesameExportShipment.create({data:{tradeRef:trade.tradeRef,warehouseName:input.warehouseName,directThirdParty:!!direct,dispatchLocation:direct?.dispatchLocation,movementDate:direct?.movementDate,documentLinks:direct?.documentLinks??[],totalWeightKg:0,ratePkrPerKg:rate,quotedCurrency:trade.currency,fxRate:fx,defaultAmountPkr:0,amountPkr:0,createdBy:input.recordedByName}});
  if(group.directThirdParty&&group.dispatchLocation!==direct?.dispatchLocation)throw new Error('Finish the open shipment before changing dispatch location');
  const numbers=input.containers.map(t=>t.containerNo.toUpperCase()).filter(Boolean);if(new Set(numbers).size!==numbers.length)throw new Error('Container numbers must be unique within the shipment');
  if(await db.pendingTruck.count({where:{exportShipment:{tradeRef:trade.tradeRef},containerNo:{in:numbers}}}))throw new Error('This container is already recorded against this trade');
  for(const [index,item] of input.containers.entries()){
   const gatepassNo=gatepassNumbers?.[index]??await nextSerial(SERIALS.GATEPASS_OUTBOUND,db);
   const truck=await db.pendingTruck.create({data:{exportShipmentId:group.id,containerNo:item.containerNo.toUpperCase()||null,croNo:item.croNo||null,truckNo:item.truckNo.toUpperCase(),gatepassNo,arrivalDate:direct?.movementDate??new Date(),movementType:trade.direction==='BUY'?'INBOUND':'OUTBOUND',status:'ASSIGNED',warehouseName:direct?'':input.warehouseName,counterpartyName:trade.counterparty.name,commodityCode:code,commodityName:trade.commodity.name,executionEntity:entity,recordedByName:input.recordedByName,transporterName:input.transporterName,transporterPhone:input.transporterPhone,remarks:input.remarks,builtyDetails:item.croNo,weightKg:item.weightKg,weightAsPerBuiltyKg:item.weightKg,remainingKg:0,assignedTradeRef:trade.tradeRef,assignedAt:new Date()}});
   if(!direct)await db.outboundDispatch.create({data:{gatepassNo,tradeRef:trade.tradeRef,dispatchDate:new Date(),liftedBy:input.transporterName||input.recordedByName,buyerName:trade.counterparty.name,warehouseName:input.warehouseName,truckNo:truck.truckNo,dispatchWeightKg:item.weightKg,invoiceWeightKg:item.weightKg,fungusPct:0,doRef:gatepassNo,allocatedQtyMt:item.weightKg/1000,amountDue:money(item.weightKg*rate),status:'AT_GATE'}});
  }
  const newWeight=weight(n(group.totalWeightKg)+total),amount=money(newWeight*n(group.ratePkrPerKg));
  await db.sesameExportShipment.update({where:{id:group.id},data:{...(direct?{documentLinks:[...new Set([...(Array.isArray(group.documentLinks)?group.documentLinks.filter((v):v is string=>typeof v==="string"):[]),...direct.documentLinks])]}:{}),totalWeightKg:newWeight,defaultAmountPkr:amount,amountPkr:amount,revision:{increment:1},audit:audit(group,input.recordedByName,'Containers added',{weightKg:total})}});
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
  if(action==='generate'){if(!['DRAFT','REJECTED'].includes(s.status))throw new Error('Shipment is not ready for a DO');validTrade(s.trade,s.directThirdParty);if(!s.trucks.length)throw new Error('Add containers first');data.deliveryOrderNo=await nextSerial(SERIALS.DELIVERY_ORDER,db);data.status='TRADER_PENDING';}
  if(action==='trader'){requireStage('TRADER_PENDING');data.traderApprovedBy=actor;data.status='EXECUTION_PENDING';}
  if(action==='execution'){requireStage('EXECUTION_PENDING');data.executionApprovedBy=actor;data.status='FINANCE_PENDING';}
  if(action==='finance'){requireStage('FINANCE_PENDING');data.financeApprovedBy=actor;data.status='APPROVED';data.gateOutSlipNo=await nextSerial(SERIALS.GATE_OUT_SLIP,db);}
  if(action==='reject'){requireStage(value!.expectedStage!);if(!value?.reason?.trim())throw new Error('Enter a rejection reason');data.status='REJECTED';data.audit=audit(s,actor,'DO rejected',{reason:value.reason,voidDo:s.deliveryOrderNo??''});data.deliveryOrderNo=null;data.traderApprovedBy=null;data.executionApprovedBy=null;data.financeApprovedBy=null;}
  if(action==='release'){
   requireStage('APPROVED');if(!s.gateOutSlipNo)throw new Error('Approved gate-out slip required');
   const grade=sesameGrade(s.trade.tradeParams);const stock=(await sesameGrades(db,s.trade.commodity.code)).find(w=>w.name===s.warehouseName)?.grades[grade]??0;
   if(!s.directThirdParty&&n(s.totalWeightKg)>stock*1000+.001)throw new Error('Physical grade stock no longer covers this shipment');
   for(const t of s.trucks){if(t.saleReleasedAt)throw new Error('Container already released');if(!s.directThirdParty&&t.executionEntity==='FZCO')await releaseFzcoOwnership(db,t.id,actor);await db.pendingTruck.update({where:{id:t.id},data:{saleReleasedAt:new Date(),saleReleasedBy:actor}});await db.outboundDispatch.updateMany({where:{gatepassNo:t.gatepassNo,status:'AT_GATE'},data:{status:'RELEASED',doRef:s.deliveryOrderNo!,dispatchDate:new Date()}});}
   data.status='RELEASED';data.releasedAt=new Date();
  }
  if(action==='bl'){
   requireStage('RELEASED');const blNo=value?.blNo?.trim().toUpperCase();if(!blNo)throw new Error('Enter BL number after loading onto the vessel');if(await db.sesameExportShipment.findUnique({where:{blNo}}))throw new Error('This BL already belongs to another DO');data.blNo=blNo;data.blRecordedAt=new Date();data.status='BL_RECORDED';
   await db.counterpartyLedgerEntry.create({data:{exportShipmentId:id,counterpartyId:s.trade.counterpartyId,tradeRef:s.tradeRef,side:s.trade.direction,entryType:'DEBIT',sourceType:'INVOICE',sourceRef:blNo,amountPkr:s.amountPkr,note:`Sesame export BL ${blNo} · DO ${s.deliveryOrderNo} · ${s.totalWeightKg} kg`}});
  }
  if(action==='adjust'){
   requireStage('BL_RECORDED');if(!value?.reason?.trim()||!value.amountPkr||!Number.isFinite(value.amountPkr)||value.amountPkr<=0)throw new Error('Enter a positive final amount and adjustment reason');
   if(s.vouchers.some(v=>v.status!=='REJECTED'))throw new Error('Resolve vouchers before adjusting the BL amount');
   data.amountPkr=money(value.amountPkr);data.audit=audit(s,actor,'BL amount adjusted',{oldAmountPkr:n(s.amountPkr),amountPkr:money(value.amountPkr),reason:value.reason});await db.counterpartyLedgerEntry.update({where:{exportShipmentId:id},data:{amountPkr:money(value.amountPkr),note:`BL ${s.blNo} · DO ${s.deliveryOrderNo} · Adjusted by ${actor}: ${value.reason}`}});
  }
  return exportView(await db.sesameExportShipment.update({where:{id},data,include}));
 },{timeout:30000});
 if(action==='release')await refreshContract(result.tradeRef);
 return result;
}
export async function exportReceipt(id:string,actor:string,input:{amountPkr:number;method:string;reference:string;bankName?:string;requestKey:string}){
 return prisma.$transaction(async db=>{
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`export-receipt:${id}`}))::text`;
  const s=await db.sesameExportShipment.findUniqueOrThrow({where:{id},include});if(s.status!=='BL_RECORDED'||!s.blNo)throw new Error('Record the BL before collecting payment');
  const old=await db.voucher.findUnique({where:{id:input.requestKey}});if(old){if(old.exportShipmentId!==id||n(old.amountPkr)!==input.amountPkr||old.reference!==input.reference.trim())throw new Error('Request already used');return {voucherNo:old.voucherNo};}
  const committed=s.vouchers.filter(v=>v.status!=='REJECTED').reduce((a,v)=>a+n(v.amountPkr),0);if(input.amountPkr>n(s.amountPkr)-committed+.005)throw new Error('Receipt exceeds the remaining BL balance including pending vouchers');
  if(s.trade.direction==='SELL'&&!input.reference.trim())throw new Error('Enter payment reference');if(s.trade.direction==='SELL'&&input.method==='Bank transfer'&&!input.bankName?.trim())throw new Error('Enter bank name');
  const voucherNo=await nextSerial(SERIALS.VOUCHER,db);
  await db.voucher.create({data:{id:input.requestKey,exportShipmentId:id,voucherNo,counterpartyId:s.trade.counterpartyId,tradeRef:s.tradeRef,commodityCode:s.trade.commodity.code,executionEntity:tradeEntity(s.trade.tradeParams),side:s.trade.direction,amountPkr:input.amountPkr,method:input.method,reference:s.trade.direction==='BUY'?null:input.reference.trim(),bankName:input.bankName?.trim(),note:`BL ${s.blNo} · DO ${s.deliveryOrderNo} · ${s.totalWeightKg} kg`,enteredByName:actor}});
  return {voucherNo};
 });
}
