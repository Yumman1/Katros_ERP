import {z} from 'zod';
import {isDeepStrictEqual} from 'node:util';
import {prisma} from '@/server/db';
import {nextSerial,SERIALS} from '@/server/db/serials';
import {tradeEntity,internalEntity} from '@/lib/sesame-entity';
import {isSesameCommodity} from '@/lib/sesame';
import {addExportContainers,directGateInput} from './sesame-export';
export const fzcoIntakeInput=directGateInput.omit({tradeRef:true}).extend({counterpartyId:z.string().min(1),side:z.enum(['BUY','SELL']),commodityCode:z.string().min(1)});
export async function directChoices(code?:string){
 const rows=await prisma.trade.findMany({where:{directSettled:false,tradeStatus:{in:['LOCKED','CONFIRMED','EXECUTED']},contract:{contractStatus:'Open'},commodity:{code}},include:{commodity:true,counterparty:true,contract:true}});
 return rows.filter(t=>isSesameCommodity(t.commodity.code)&&tradeEntity(t.tradeParams)==='FZCO'&&!internalEntity(t.tradeParams)&&t.currency==='USD').map(t=>({tradeRef:t.tradeRef,side:t.direction,counterpartyId:t.counterpartyId,counterparty:t.counterparty.name,commodityCode:t.commodity.code,commodity:t.commodity.name,openMt:Number(t.contract?.openQtyMt??0)}));
}
export async function logFzcoIntake(input:z.infer<typeof fzcoIntakeInput>,actor:string){
 const parsed=fzcoIntakeInput.parse(input);if(!isSesameCommodity(parsed.commodityCode))throw new Error('Choose Sesame');
 const payload=JSON.parse(JSON.stringify(parsed));
 return prisma.$transaction(async db=>{
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`gate-intake:${input.requestKey}`}))::text`;
  const old=await db.sesameExportGateIntake.findUnique({where:{id:input.requestKey}});
  if(old){const saved=old.payload as {input:unknown;gatepasses:string[]};if(!old.directThirdParty||!isDeepStrictEqual(saved.input,payload))throw new Error('Request already used');return {gatepasses:saved.gatepasses};}
  const cp=await db.counterparty.findUniqueOrThrow({where:{id:input.counterpartyId}});await db.counterparty.findUniqueOrThrow({where:{id:input.holderId}});
  const gatepasses:string[]=[];for(const _c of input.containers)gatepasses.push(await nextSerial(input.side==='SELL'?SERIALS.GATEPASS_OUTBOUND:SERIALS.GATEPASS_INBOUND,db));
  await db.sesameExportGateIntake.create({data:{id:input.requestKey,directThirdParty:true,warehouseName:'',counterpartyName:cp.name,commodityCode:input.commodityCode,recordedByName:actor,payload:{input:payload,gatepasses}}});
  return {gatepasses};
 });
}
export async function pendingFzcoIntakes(code?:string){
 const rows=await prisma.sesameExportGateIntake.findMany({where:{directThirdParty:true,shipmentId:null,commodityCode:code},orderBy:{createdAt:'asc'}});const trades=await directChoices(code);
 return rows.map(r=>{const data=r.payload as unknown as {input:z.infer<typeof fzcoIntakeInput>;gatepasses:string[]};return {id:r.id,counterparty:r.counterpartyName,...data,choices:trades.filter(t=>t.side===data.input.side&&t.counterpartyId===data.input.counterpartyId&&t.commodityCode===r.commodityCode)};});
}
export async function assignFzcoIntake(id:string,tradeRef:string,code:string,actor:string){
 return prisma.$transaction(async db=>{
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`gate-intake:${id}`}))::text`;
  const row=await db.sesameExportGateIntake.findUniqueOrThrow({where:{id}});if(!row.directThirdParty||row.commodityCode!==code||row.shipmentId)throw new Error('Gate entry is not available in this desk');
  const saved=row.payload as unknown as {input:z.infer<typeof fzcoIntakeInput>;gatepasses:string[]};const input=fzcoIntakeInput.parse(saved.input);
  const trade=await db.trade.findUniqueOrThrow({where:{tradeRef},include:{commodity:true}});if(trade.counterpartyId!==input.counterpartyId||trade.direction!==input.side||trade.commodity.code!==code)throw new Error('Trade must match the movement counterparty, side and commodity');
  const group=await addExportContainers({...input,tradeRef,warehouseName:'FZCO THIRD PARTY',recordedByName:row.recordedByName},input,db,saved.gatepasses);
  await db.sesameExportGateIntake.update({where:{id},data:{shipmentId:group.id,assignedAt:new Date()}});
  return group;
 },{timeout:30000});
}
