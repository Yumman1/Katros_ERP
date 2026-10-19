import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {prisma} from '@/server/db';
import {nextSerial,SERIALS} from '@/server/db/serials';
import {getCompanyWarehouses} from '@/server/trader-master-data';
import {exportGateInput,exportGateTrades,addExportContainers,tripartyGateTrades} from './sesame-export';
/**
 * Warehouse gate entry for international sesame containers. `triparty` marks a
 * Pakistan → Dubai FZCO internal sale shipped straight to FZCO's buyer: the gate
 * records the final buyer; execution later assigns both trades.
 */
export const intakeInput=exportGateInput.omit({tradeRef:true}).extend({counterpartyName:z.string().trim().min(1),commodityCode:z.string().trim().min(1),triparty:z.boolean().default(false)});
export async function logExportGate(raw:z.infer<typeof intakeInput>){
 const input=intakeInput.parse(raw);
 if(!(await getCompanyWarehouses()).some(w=>w.name===input.warehouseName))throw new Error('Select a company warehouse');
 if(input.triparty){
  const {internal,fzco}=await tripartyGateTrades(input.warehouseName);
  if(!internal.some(t=>t.commodityCode===input.commodityCode))throw new Error('No open Pakistan → Dubai FZCO internal sale is allocated to this warehouse');
  if(!fzco.some(t=>t.counterpartyName===input.counterpartyName&&t.commodityCode===input.commodityCode))throw new Error('Select a buyer with an open Dubai FZCO international sale');
 }else{
  const eligible=await exportGateTrades(input.warehouseName);
  if(!eligible.some(t=>t.counterpartyName===input.counterpartyName&&t.commodityCode===input.commodityCode))throw new Error('Select a counterparty and commodity with an open international Sesame sale');
 }
 const numbers=input.containers.map(c=>c.containerNo.toUpperCase());if(new Set(numbers).size!==numbers.length)throw new Error('Container numbers must be unique in this entry');
 return prisma.$transaction(async db=>{
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`gate-intake:${input.requestKey}`}))::text`;
  const old=await db.sesameExportGateIntake.findUnique({where:{id:input.requestKey}});
  if(old){const saved=old.payload as {input:unknown;gatepasses:string[]};if(!isDeepStrictEqual(saved.input,input))throw new Error('Request already used for a different entry');return {id:old.id,gatepasses:saved.gatepasses};}
  const gatepasses:string[]=[];for(const _row of input.containers)gatepasses.push(await nextSerial(SERIALS.GATEPASS_OUTBOUND,db));
  await db.sesameExportGateIntake.create({data:{id:input.requestKey,triparty:input.triparty,warehouseName:input.warehouseName,counterpartyName:input.counterpartyName,commodityCode:input.commodityCode,recordedByName:input.recordedByName,payload:{input,gatepasses}}});
  return {id:input.requestKey,gatepasses};
 });
}
export async function pendingExportGates(code?:string){
 const rows=await prisma.sesameExportGateIntake.findMany({where:{directThirdParty:false,shipmentId:null,...(code?{commodityCode:code}:{})},orderBy:{createdAt:'asc'}});
 return Promise.all(rows.map(async r=>{
  const data=r.payload as {input:z.infer<typeof intakeInput>;gatepasses:string[]};
  const base={id:r.id,triparty:r.triparty,warehouseName:r.warehouseName,counterpartyName:r.counterpartyName,commodityCode:r.commodityCode,createdAt:r.createdAt,...data};
  if(r.triparty){const {internal,fzco}=await tripartyGateTrades(r.warehouseName);return {...base,choices:[] as {tradeRef:string;entity:string}[],internalChoices:internal.filter(t=>t.commodityCode===r.commodityCode),fzcoChoices:fzco.filter(t=>t.counterpartyName===r.counterpartyName&&t.commodityCode===r.commodityCode)};}
  return {...base,choices:(await exportGateTrades(r.warehouseName)).filter(t=>t.counterpartyName===r.counterpartyName&&t.commodityCode===r.commodityCode),internalChoices:[] as Awaited<ReturnType<typeof tripartyGateTrades>>['internal'],fzcoChoices:[] as Awaited<ReturnType<typeof tripartyGateTrades>>['fzco']};
 }));
}
export async function assignExportGate(id:string,tradeRef:string,_actor:string,code?:string,fzcoSaleTradeRef?:string){
 const warehouses=await getCompanyWarehouses();
 return prisma.$transaction(async db=>{
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`gate-intake:${id}`}))::text`;
  const row=await db.sesameExportGateIntake.findUniqueOrThrow({where:{id}});
  if(row.directThirdParty)throw new Error('Use FZCO trade assignment');
  if(!warehouses.some(w=>w.name===row.warehouseName))throw new Error('Warehouse is no longer registered');
  if(code&&row.commodityCode!==code)throw new Error('Switch to the correct commodity desk');
  if(row.shipmentId)throw new Error('This gate entry is already assigned');
  const trade=await db.trade.findUniqueOrThrow({where:{tradeRef},include:{counterparty:true,commodity:true}});
  if(trade.commodity.code!==row.commodityCode)throw new Error('Trade must match the gate entry commodity');
  const data=row.payload as {input:z.infer<typeof intakeInput>;gatepasses:string[]};
  let shipment;
  if(row.triparty){
   if(!fzcoSaleTradeRef)throw new Error('Select the Dubai FZCO sale to the buyer');
   const fzcoSale=await db.trade.findUniqueOrThrow({where:{tradeRef:fzcoSaleTradeRef},include:{counterparty:true}});
   if(fzcoSale.counterparty.name!==row.counterpartyName)throw new Error('FZCO sale must match the buyer recorded at the gate');
   shipment=await addExportContainers({...data.input,tradeRef},undefined,db,data.gatepasses,{fzcoSaleTradeRef});
  }else{
   if(trade.counterparty.name!==row.counterpartyName)throw new Error('Trade must match the gate entry counterparty and commodity');
   shipment=await addExportContainers({...data.input,tradeRef},undefined,db,data.gatepasses);
  }
  await db.sesameExportGateIntake.update({where:{id},data:{shipmentId:shipment.id,assignedAt:new Date()}});
  return shipment;
 },{timeout:30000});
}
