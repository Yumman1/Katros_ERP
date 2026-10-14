import {z} from 'zod';
import {TRPCError} from '@trpc/server';
import {router,roleProcedure,headProcedure} from '@/server/trpc/trpc';
import {prisma} from '@/server/db';
import {traderNamesMatch} from '@/lib/trader-identity';
import {isSesameCommodity} from '@/lib/sesame';
import {internalEntity} from '@/lib/sesame-entity';
import {tradeEntity} from '@/lib/sesame-entity';
import {exportRows,exportView,exportAction,exportReceipt,addExportContainers,directGateInput} from '@/server/execution/sesame-export';
import type {Context} from '@/server/trpc/context';
const identity=z.object({id:z.string(),revision:z.number().int().nonnegative()});
async function access(ctx:Context,id:string,financial=false){
 const user=ctx.session!.user;const dbUser=await prisma.user.findUniqueOrThrow({where:{id:user.id}});if(dbUser.disabled)throw new TRPCError({code:'FORBIDDEN'});
 const s=await prisma.sesameExportShipment.findUniqueOrThrow({where:{id},include:{trade:{include:{commodity:true}}}});
 if(user.role==='TRADER'&&!traderNamesMatch(s.trade.traderName,user.name??''))throw new TRPCError({code:'FORBIDDEN'});
 if(ctx.executionCommodityCode&&ctx.executionCommodityCode!==s.trade.commodity.code)throw new TRPCError({code:'FORBIDDEN'});
 if(ctx.executionEntity&&ctx.executionEntity!==(financial?tradeEntity(s.trade.tradeParams):s.directThirdParty?'FZCO':'PAK'))throw new TRPCError({code:'FORBIDDEN'});
 return s;
}
const actor=(ctx:Context)=>ctx.session!.user.name??ctx.session!.user.id;
async function action<T>(fn:()=>Promise<T>){try{return await fn();}catch(e){if(e instanceof TRPCError)throw e;throw new TRPCError({code:'BAD_REQUEST',message:e instanceof Error?e.message:'Shipment action failed'});}}
export const sesameExportRouter=router({
 usdLedger:roleProcedure(['EXECUTION','TRADER','FINANCE']).query(async({ctx})=>{
  const user=await prisma.user.findUniqueOrThrow({where:{id:ctx.session.user.id}});if(user.disabled)throw new TRPCError({code:'FORBIDDEN'});
  const trades=(await prisma.trade.findMany({include:{commodity:true,counterparty:true},where:{commodity:ctx.executionCommodityCode?{code:ctx.executionCommodityCode}:undefined}})).filter(t=>isSesameCommodity(t.commodity.code)&&tradeEntity(t.tradeParams)==='FZCO'&&(ctx.session.user.role!=='TRADER'||traderNamesMatch(t.traderName,ctx.session.user.name??'')));
  const records=await prisma.counterpartyLedgerEntry.findMany({where:{tradeRef:{in:trades.map(t=>t.tradeRef)}},include:{exportShipment:true,voucher:{include:{exportShipment:true}}},orderBy:{entryDate:'desc'}});
  return trades.map(t=>{
   const params=t.tradeParams as Record<string,unknown>|null;
   const entries=records.filter(e=>e.tradeRef===t.tradeRef).map(e=>{const fx=Number(e.exportShipment?.fxRate??e.voucher?.exportShipment?.fxRate??params?.executionFxPkrPerUsd);return {id:e.id,date:e.entryDate,reference:e.sourceRef,description:e.note,type:e.entryType,amountUsd:fx>0?Number(e.amountPkr)/fx:null};});
   const balance=entries.reduce((a,e)=>a+(e.type==='DEBIT'?1:-1)*(e.amountUsd??0),0);
   return {tradeRef:t.tradeRef,counterparty:t.counterparty.name,side:t.direction,balanceUsd:balance,missingFx:entries.some(e=>e.amountUsd===null),entries};
  }).filter(t=>t.entries.length);
 }),
 directTrades:roleProcedure(['EXECUTION']).query(async({ctx})=>{
  if(ctx.executionEntity!=='FZCO')throw new TRPCError({code:'FORBIDDEN',message:'Open FZCO execution'});
  const user=await prisma.user.findUniqueOrThrow({where:{id:ctx.session.user.id}});if(user.disabled)throw new TRPCError({code:'FORBIDDEN'});
  const rows=await prisma.trade.findMany({where:{directSettled:false,tradeStatus:{in:['LOCKED','CONFIRMED','EXECUTED']},contract:{contractStatus:'Open'},commodity:{code:ctx.executionCommodityCode}},include:{commodity:true,counterparty:true,contract:true}});
  return rows.filter(t=>isSesameCommodity(t.commodity.code)&&tradeEntity(t.tradeParams)==='FZCO'&&!internalEntity(t.tradeParams)&&t.currency==='USD').map(t=>({tradeRef:t.tradeRef,side:t.direction,counterparty:t.counterparty.name,commodity:t.commodity.name,tradeScope:t.tradeScope,openMt:Number(t.contract?.openQtyMt??0)}));
 }),
 addDirect:roleProcedure(['EXECUTION']).input(directGateInput).mutation(async({ctx,input})=>{
  if(ctx.executionEntity!=='FZCO')throw new TRPCError({code:'FORBIDDEN',message:'Open FZCO execution'});
  const user=await prisma.user.findUniqueOrThrow({where:{id:ctx.session.user.id}});if(user.disabled)throw new TRPCError({code:'FORBIDDEN'});
  return action(()=>addExportContainers({...input,warehouseName:'FZCO THIRD PARTY',recordedByName:actor(ctx)},input));
 }),
 list:roleProcedure(['EXECUTION','TRADER','FINANCE']).query(async({ctx})=>{
  const user=await prisma.user.findUniqueOrThrow({where:{id:ctx.session.user.id}});if(user.disabled)throw new TRPCError({code:'FORBIDDEN'});
  return (await exportRows()).filter(s=>(ctx.session.user.role!=='TRADER'||traderNamesMatch(s.trade.traderName,ctx.session.user.name??''))&&(!ctx.executionCommodityCode||s.trade.commodity.code===ctx.executionCommodityCode)&&(!ctx.executionEntity||tradeEntity(s.trade.tradeParams)===ctx.executionEntity||(ctx.executionEntity==='PAK'&&!s.directThirdParty))).map(s=>({...exportView(s),paymentReadOnly:!!ctx.executionEntity&&ctx.executionEntity!==tradeEntity(s.trade.tradeParams),movementReadOnly:ctx.executionEntity==='FZCO'&&!s.directThirdParty}));
 }),
 generate:roleProcedure(['EXECUTION']).input(identity).mutation(async({ctx,input})=>{await access(ctx,input.id);return action(()=>exportAction(input.id,input.revision,actor(ctx),'generate'));}),
 traderApprove:roleProcedure(['TRADER']).input(identity).mutation(async({ctx,input})=>{await access(ctx,input.id);return action(()=>exportAction(input.id,input.revision,actor(ctx),'trader'));}),
 executionApprove:headProcedure('EXECUTION').input(identity).mutation(async({ctx,input})=>{await access(ctx,input.id);return action(()=>exportAction(input.id,input.revision,actor(ctx),'execution'));}),
 financeApprove:roleProcedure(['FINANCE']).input(identity).mutation(async({ctx,input})=>{await access(ctx,input.id);return action(()=>exportAction(input.id,input.revision,actor(ctx),'finance'));}),
 reject:roleProcedure(['TRADER','EXECUTION','FINANCE']).input(identity.extend({reason:z.string().trim().min(1).max(1000)})).mutation(async({ctx,input})=>{
  const s=await access(ctx,input.id),u=ctx.session.user;const allowed=u.role==='CEO'||u.role==='ADMIN'||(s.status==='TRADER_PENDING'&&u.role==='TRADER')||(s.status==='EXECUTION_PENDING'&&u.role==='EXECUTION'&&u.isHead)||(s.status==='FINANCE_PENDING'&&u.role==='FINANCE');
  if(!allowed||!['TRADER_PENDING','EXECUTION_PENDING','FINANCE_PENDING'].includes(s.status))throw new TRPCError({code:'FORBIDDEN'});
  return action(()=>exportAction(input.id,input.revision,actor(ctx),'reject',{reason:input.reason,expectedStage:s.status}));
 }),
 release:roleProcedure(['EXECUTION']).input(identity).mutation(async({ctx,input})=>{await access(ctx,input.id);return action(()=>exportAction(input.id,input.revision,actor(ctx),'release'));}),
 recordBl:roleProcedure(['EXECUTION']).input(identity.extend({blNo:z.string().trim().min(1).max(120)})).mutation(async({ctx,input})=>{await access(ctx,input.id);return action(()=>exportAction(input.id,input.revision,actor(ctx),'bl',{blNo:input.blNo}));}),
 adjustBl:roleProcedure(['FINANCE']).input(identity.extend({amountPkr:z.number().finite().positive().multipleOf(.01),reason:z.string().trim().min(1).max(1000)})).mutation(async({ctx,input})=>{await access(ctx,input.id);return action(()=>exportAction(input.id,input.revision,actor(ctx),'adjust',input));}),
 receipt:roleProcedure(['EXECUTION']).input(z.object({id:z.string(),amountPkr:z.number().finite().positive().multipleOf(.01),method:z.enum(['Bank transfer','Cheque','Cash','Other']),reference:z.string().trim().max(120),bankName:z.string().trim().max(120).optional(),requestKey:z.string().uuid()})).mutation(async({ctx,input})=>{await access(ctx,input.id,true);return action(()=>exportReceipt(input.id,actor(ctx),input));}),
});
