import {sesameGrade} from '@/lib/sesame-processing';
import {quantityUnitToKg} from '@/lib/unit-conversion';
import {custodyRows} from './fzco-custody';
import {z} from 'zod';
import {isDeepStrictEqual} from 'node:util';
import {prisma} from '@/server/db';
import {nextSerial,SERIALS} from '@/server/db/serials';
import {tradeEntity,internalEntity} from '@/lib/sesame-entity';
import {usesSesameWorkflow} from '@/lib/sesame';
import {addExportContainers,directGateInput} from './sesame-export';
export const fzcoIntakeInput=directGateInput.omit({tradeRef:true}).extend({counterpartyId:z.string().min(1),side:z.enum(['BUY','SELL']),commodityCode:z.string().min(1),triparty:z.boolean().default(false)});
export async function directChoices(code?:string){
 const rows=await prisma.trade.findMany({where:{directSettled:false,tradeStatus:{in:['LOCKED','CONFIRMED','EXECUTED']},contract:{openQtyMt:{gt:0}},commodity:{code}},include:{commodity:true,counterparty:true,contract:true}});
 return rows.filter(t=>usesSesameWorkflow(t.commodity.code)&&tradeEntity(t.tradeParams)==='FZCO'&&!internalEntity(t.tradeParams)&&t.currency==='USD').map(t=>({tradeRef:t.tradeRef,side:t.direction,counterpartyId:t.counterpartyId,counterparty:t.counterparty.name,commodityCode:t.commodity.code,commodity:t.commodity.name,grade:sesameGrade(t.tradeParams),openMt:Number(t.contract?.openQtyMt??0)}));
}
export async function logFzcoIntake(input:z.input<typeof fzcoIntakeInput>,actor:string){
 const parsed=fzcoIntakeInput.parse({...input,triparty:true});if(parsed.side!=='SELL')throw new Error('Third-party movements use Triparty sale. Purchases are recorded automatically against the supplier.');if(!usesSesameWorkflow(parsed.commodityCode))throw new Error('Choose Sesame');
 if(parsed.triparty&&parsed.side!=='SELL')throw new Error('Triparty gate-out requires Sale movement');
 if(parsed.triparty&&parsed.containers.some(c=>!c.containerNo.trim()||!c.croNo.trim()))throw new Error('Enter container and CRO numbers for every triparty container');
 const payload=JSON.parse(JSON.stringify(parsed));
 return prisma.$transaction(async db=>{
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`gate-intake:${input.requestKey}`}))::text`;
  const old=await db.sesameExportGateIntake.findUnique({where:{id:input.requestKey}});
  if(old){const saved=old.payload as {input:unknown;gatepasses:string[]};if(!old.directThirdParty||!isDeepStrictEqual(saved.input,payload))throw new Error('Request already used');return {gatepasses:saved.gatepasses};}
  const cp=await db.counterparty.findUniqueOrThrow({where:{id:input.counterpartyId}});await db.counterparty.findUniqueOrThrow({where:{id:input.holderId}});
  const gatepasses:string[]=[];for(const _c of input.containers)gatepasses.push(await nextSerial(input.side==='SELL'?SERIALS.GATEPASS_OUTBOUND:SERIALS.GATEPASS_INBOUND,db));
  await db.sesameExportGateIntake.create({data:{id:input.requestKey,directThirdParty:true,triparty:parsed.triparty,warehouseName:'',counterpartyName:cp.name,commodityCode:input.commodityCode,recordedByName:actor,payload:{input:payload,gatepasses}}});
  return {gatepasses};
 });
}
export async function sourcePurchaseChoices(code?:string){
 const rows=await prisma.trade.findMany({where:{direction:'BUY',tradeStatus:{in:['LOCKED','CONFIRMED','EXECUTED']},commodity:{code},contract:{isNot:null}},include:{commodity:true,counterparty:true,contract:true}});
 const groups=await prisma.sesameExportShipment.groupBy({by:['sourcePurchaseTradeRef'],where:{sourcePurchaseTradeRef:{not:null},status:{not:'REJECTED'}},_sum:{totalWeightKg:true}});
 const used=new Map(groups.map(g=>[g.sourcePurchaseTradeRef,Number(g._sum.totalWeightKg??0)]));
 const codes=[...new Set(rows.map(t=>t.commodity.code))];
 const stock=new Map(await Promise.all(codes.map(async c=>[c,await custodyRows(prisma,c)] as const)));
 return rows.filter(t=>tradeEntity(t.tradeParams)==='FZCO'&&!internalEntity(t.tradeParams)).map(t=>{
  const grade=sesameGrade(t.tradeParams);
  const remainingMt=(quantityUnitToKg(Number(t.contract!.contractualQtyMt)+Number(t.contract!.quantityToleranceMt),t.contract!.quantityUnit)-(used.get(t.tradeRef)??0))/1000;
  const held=stock.get(t.commodity.code)?.find(r=>r.holderId===t.counterpartyId&&r.grade===grade);
  return {tradeRef:t.tradeRef,counterpartyId:t.counterpartyId,counterparty:t.counterparty.name,grade,commodityCode:t.commodity.code,availableMt:Math.max(0,Math.min(remainingMt,held?.availableMt??0))};
 });
}
export async function pendingFzcoIntakes(code?:string){
 const rows=await prisma.sesameExportGateIntake.findMany({where:{directThirdParty:true,shipmentId:null,commodityCode:code},orderBy:{createdAt:'asc'}});const trades=await directChoices(code);const purchases=await sourcePurchaseChoices(code);
 return rows.map(r=>{const data=r.payload as unknown as {input:z.infer<typeof fzcoIntakeInput>;gatepasses:string[]};return {id:r.id,counterparty:r.counterpartyName,...data,input:{...data.input,triparty:data.input.side==='SELL'},purchaseChoices:purchases.filter(t=>t.counterpartyId===data.input.holderId&&t.commodityCode===r.commodityCode),choices:trades.filter(t=>t.side===data.input.side&&t.counterpartyId===data.input.counterpartyId&&t.commodityCode===r.commodityCode)};});
}
export async function assignFzcoIntake(id:string,tradeRef:string,code:string,actor:string,sourcePurchaseTradeRef?:string){
 return prisma.$transaction(async db=>{
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`gate-intake:${id}`}))::text`;
  const row=await db.sesameExportGateIntake.findUniqueOrThrow({where:{id}});if(!row.directThirdParty||row.commodityCode!==code||row.shipmentId)throw new Error('Gate entry is not available in this desk');
  const saved=row.payload as unknown as {input:z.infer<typeof fzcoIntakeInput>;gatepasses:string[]};const input=fzcoIntakeInput.parse({...saved.input,triparty:saved.input.side==='SELL'});
  const trade=await db.trade.findUniqueOrThrow({where:{tradeRef},include:{commodity:true}});if(trade.counterpartyId!==input.counterpartyId||trade.direction!==input.side||trade.commodity.code!==code)throw new Error('Trade must match the movement counterparty, side and commodity');
  if(input.triparty&&!sourcePurchaseTradeRef)throw new Error('Select the supplier purchase for this triparty contract');
  if(!input.triparty&&sourcePurchaseTradeRef)throw new Error('Use triparty gate-out to link a supplier purchase');
  const group=await addExportContainers({...input,tradeRef,warehouseName:'FZCO THIRD PARTY',recordedByName:row.recordedByName},{...input,sourcePurchaseTradeRef},db,saved.gatepasses);
  await db.sesameExportGateIntake.update({where:{id},data:{shipmentId:group.id,assignedAt:new Date()}});
  return group;
 },{timeout:30000});
}
