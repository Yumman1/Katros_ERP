import {prisma} from '@/server/db';
import {randomUUID} from 'crypto';
import type {User} from '@prisma/client';
import type {PkeImportPayload} from '@/lib/pke-import';
import {pkeShortage,type PkeShipmentReview} from '@/lib/pke-shipment-review';
import {traderNamesMatch} from '@/lib/trader-identity';
import {settlePkeTrade} from '@/server/finance/pke-settlement';
const n=(v:unknown)=>Number(v??0);
export async function shipmentReviews(user:User){
 const [files,trades]=await Promise.all([prisma.pkeImportFile.findMany({orderBy:{updatedAt:'desc'}}),prisma.trade.findMany({where:{commodity:{code:'PKE'}},include:{contract:true}})]);
 return files.flatMap(f=>{const t=trades.find(t=>t.tradeRef===f.purchaseTradeRef);if(!t||user.role==='TRADER'&&!traderNamesMatch(t.traderName,user.name??user.email))return [];
 const p=f.payload as unknown as PkeImportPayload;return [{id:f.id,title:f.title,tradeRef:f.purchaseTradeRef,saleRef:p.references['Dubai sale trade reference'],contractMt:n(t.quantity),toleranceMt:n(t.contract?.quantityToleranceMt),blMt:n(p.references['BL quantity MT']),receivedMt:n(p.references['Vessel received MT']),arrived:!!p.references['Vessel arrival date'],reviews:p.shipmentReviews??[]}];});
}
export async function registerInsurer(name:string,user:User){return prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('pke-insurers'))::text`;const old=await tx.counterparty.findFirst({where:{name:{equals:name,mode:'insensitive'},code:{startsWith:'INS-'}}});return old??tx.counterparty.create({data:{code:`INS-${randomUUID().slice(0,12)}`,name,type:'TRADING_PARTNER',country:'Pakistan',tradingEntities:['PAK','FZCO'],createdById:user.id}});});}
export async function reviewShipment(input:{id:string;action:'INSURANCE'|'SHORTFALL'|'APPROVED'|'REJECTED'|'CANCELLED';reviewId?:string;insurerId?:string;reason:string},user:User){return prisma.$transaction(async tx=>{
 await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('pke-shipment-review'))::text`;
 await tx.$queryRaw`SELECT id FROM "PkeImportFile" WHERE id=${input.id} FOR UPDATE`;
 const file=await tx.pkeImportFile.findUniqueOrThrow({where:{id:input.id}});const p=file.payload as unknown as PkeImportPayload;p.shipmentReviews??=[];
 const trade=await tx.trade.findUniqueOrThrow({where:{tradeRef:file.purchaseTradeRef},include:{contract:true,commodity:true}});
 if(trade.commodity.code!=='PKE'||!trade.contract||trade.tradeStatus==='CANCELLED')throw new Error('Select an active locked PKE import');
 const name=user.name??user.email;
 if(input.action==='INSURANCE'||input.action==='SHORTFALL'){
  if(!['EXECUTION','CEO'].includes(user.role))throw new Error('Only Execution can request approval');
  if(p.shipmentReviews.some(q=>q.kind===input.action&&['PENDING','APPROVED'].includes(q.status)))throw new Error('A request already exists');
  const bl=n(p.references['BL quantity MT']),received=n(p.references['Vessel received MT']),tolerance=n(trade.contract.quantityToleranceMt);
  const loss=pkeShortage(bl,received,tolerance);let quantity=loss.missing;
  if(input.action==='INSURANCE'&&(!p.references['Vessel arrival date']||!loss.claimable||!input.insurerId))throw new Error('Select an insurer after arrival; shortage must exceed tolerance');
  if(input.action==='SHORTFALL'){const siblings=await tx.pkeImportFile.findMany({where:{purchaseTradeRef:trade.tradeRef}});quantity=n(trade.quantity)-siblings.reduce((s,f)=>s+n((f.payload as unknown as PkeImportPayload).references['BL quantity MT']),0);if(quantity<=tolerance+.000001)throw new Error('Combined BL quantity is within contract tolerance');}
  const insurer=input.action==='INSURANCE'?await tx.counterparty.findFirst({where:{id:input.insurerId,code:{startsWith:'INS-'}}}):null;
  if(input.action==='INSURANCE'&&(!insurer||n(trade.contract.ratePerKg)<=0))throw new Error('Select a registered insurer and lock a positive purchase rate');
  p.shipmentReviews.push({id:randomUUID(),kind:input.action,status:'PENDING',reason:input.reason,requestedBy:name,requestedAt:new Date().toISOString(),quantityMt:quantity,amountPkr:Math.round(quantity*1000*n(trade.contract.ratePerKg)*100)/100,blMt:bl,receivedMt:received,...(insurer?{insurerId:insurer.id,insurerName:insurer.name}:{})});
 }else{
  if(user.role!=='TRADER'||!traderNamesMatch(trade.traderName,name))throw new Error('Only the assigned trader can review this request');
  const q=p.shipmentReviews.find(q=>q.id===input.reviewId);if(!q||q.status!=='PENDING')throw new Error('Request already resolved or not found');
  if(input.action==='CANCELLED'&&q.kind!=='SHORTFALL')throw new Error('Cancellation applies to purchase shortfalls');
  if(input.action==='APPROVED'&&q.kind==='INSURANCE'){
   if(Math.abs(q.amountPkr-q.quantityMt*1000*n(trade.contract.ratePerKg))>.01)throw new Error('Purchase rate changed; reject and request a fresh claim');
   q.noteRef=`INS-${q.id}`;await tx.counterpartyLedgerEntry.create({data:{counterpartyId:q.insurerId!,executionEntity:'FZCO',side:'SELL',entryType:'DEBIT',amountPkr:q.amountPkr,sourceType:'ADJUSTMENT',sourceRef:q.noteRef,tradeRef:trade.tradeRef,noteStatus:'UNPAID',note:`PKE insurance · BL ${p.references['Bill of lading']} · ${q.quantityMt} MT`}});
  }
  if(input.action==='CANCELLED'){
   const files=await tx.pkeImportFile.findMany({where:{purchaseTradeRef:trade.tradeRef}});
   const refs=new Set([trade.tradeRef,...files.map(f=>(f.payload as unknown as PkeImportPayload).references['Dubai sale trade reference']).filter(Boolean)]);
   const sales=await tx.trade.findMany({where:{commodity:{code:'PKE'},OR:files.map(f=>({tradeParams:{path:['pkePortFileId'],equals:f.id}}))}});sales.forEach(t=>refs.add(t.tradeRef));
   for(const ref of [...refs].sort())await tx.$queryRaw`SELECT id FROM "ExecutionContract" WHERE "tradeRef"=${ref} FOR UPDATE`;
   await tx.trade.updateMany({where:{tradeRef:{in:[...refs]}},data:{tradeStatus:'CANCELLED'}});
   await tx.executionContract.updateMany({where:{tradeRef:{in:[...refs]}},data:{contractStatus:'Close',openQtyMt:0}});
   await tx.voucher.updateMany({where:{tradeRef:{in:[...refs]},status:'PENDING_FINANCE'},data:{status:'REJECTED',resolvedByName:name,resolvedAt:new Date(),resolutionNote:`Import cancelled: ${input.reason}`}});
  }
  Object.assign(q,{status:input.action,reviewedBy:name,reviewedAt:new Date().toISOString()});
 }
 p.history.push({at:new Date().toISOString(),actor:name,action:`Shipment ${input.action}: ${input.reason}`});
 await tx.pkeImportFile.update({where:{id:file.id},data:{payload:JSON.parse(JSON.stringify(p)),revision:{increment:1}}});
 for(const ref of [trade.tradeRef,p.references['Dubai sale trade reference']].filter(Boolean))await settlePkeTrade(tx,ref);
 return {ok:true};
});}
