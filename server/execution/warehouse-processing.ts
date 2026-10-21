import {z} from 'zod';
import {prisma} from '@/server/db';
import type {Prisma} from '@prisma/client';
import {sesameGrades} from './sesame-processing';
import {lockSesameOwnership} from './sesame-stock';
import {processingReservedKg} from './processing-reservations';
import {sesameGrade,PROCESSING_ROUTES,processingForecast,pakistanDate} from '@/lib/sesame-processing';
import {tradeEntity} from '@/lib/sesame-entity';
import {warehouseAllowedForCommodity} from '@/lib/warehouse-eligibility';
import {quantityUnitToKg} from '@/lib/unit-conversion';
import {getCompanyWarehouses} from '@/server/trader-master-data';
import {bookedPakistanSaleKgAtWarehouse} from './sesame-sale-reservation';
const n=(v:unknown)=>Number(v??0);
const kg=z.number().finite().positive().multipleOf(0.001);
export const processingPlanInput=z.object({warehouseName:z.string().trim().min(1),unitName:z.string().trim().min(1),fromType:z.enum(['Raw','Machine Cleaned']),toType:z.enum(['Machine Cleaned','Sortex']),reservedKg:kg,dailyCapacityKg:kg,expectedYieldRatio:z.number().finite().min(0).max(1),requestKey:z.string().uuid()});
export const dailyProcessingInput=z.object({planId:z.string(),productionDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),outputKg:z.number().finite().nonnegative().multipleOf(.001),impuritiesKg:z.number().finite().nonnegative().multipleOf(.001),requestKey:z.string().uuid()});
export const editProcessingInput=z.object({id:z.string().min(1),revision:z.number().int().nonnegative(),outputKg:z.number().finite().nonnegative().multipleOf(.001),impuritiesKg:z.number().finite().nonnegative().multipleOf(.001),reason:z.string().trim().min(1).max(500)});
/** Cron is the primary runner; mutations settle any missed days before changing defaults. */
async function settleDailyDefaults(db:Prisma.TransactionClient,code:string) {
 await db.$queryRaw`SELECT public.run_sesame_daily_processing(${code})`;
}
/** Stock a warehouse can still ship: physical grade minus allocated sales, processing and trucks at gate. */
export async function processingAvailability(db:Prisma.TransactionClient,code:string,warehouse:string,grade:string,excludeTradeRef?:string) {
 const [rows,sales,pending,atGate]=await Promise.all([
  sesameGrades(db,code),
  db.trade.findMany({where:{commodity:{code},...(excludeTradeRef?{tradeRef:{not:excludeTradeRef}}:{}),directSettled:false,tradeStatus:{in:['PENDING','LOCKED','CONFIRMED','EXECUTED']}},include:{contract:{include:{warehouseAllocations:true}}}}),
  db.pendingTruck.findMany({where:{commodityCode:code,warehouseName:{equals:warehouse,mode:'insensitive'},movementType:'OUTBOUND',executionEntity:'PAK',status:{not:'ASSIGNED'}}}),
  db.outboundDispatch.findMany({where:{warehouseName:{equals:warehouse,mode:'insensitive'},status:'AT_GATE',trade:{commodity:{code}}},include:{trade:{select:{tradeParams:true}}}}),
 ]);
 const same=(v:string)=>v.trim().toLowerCase()===warehouse.trim().toLowerCase();
 const physicalKg=(rows.find(r=>same(r.name))?.grades[sesameGrade({sesameType:grade})]??0)*1000;
 const bookedKg=sales.reduce((s,t)=>s+bookedPakistanSaleKgAtWarehouse(t,warehouse,grade,excludeTradeRef),0);
 // Open allocations may already include trucks at gate; use the larger reservation.
 const gateKg=atGate.filter(r=>tradeEntity(r.trade.tradeParams)==='PAK'&&sesameGrade(r.trade.tradeParams)===grade).reduce((s,r)=>s+n(r.allocatedQtyMt)*1000,0);
 const processingKg=await processingReservedKg(db,code,warehouse,grade);
 const pendingKg=pending.reduce((s,t)=>s+n(t.remainingKg),0);
 return {physicalKg,bookedKg:Math.max(bookedKg,gateKg),processingKg,availableKg:Math.max(0,physicalKg-Math.max(bookedKg,gateKg)-processingKg-pendingKg)};
}
export async function warehouseProcessing(code:string) {
 const [warehouses,plans,history]=await Promise.all([getCompanyWarehouses(),prisma.sesameProcessingPlan.findMany({where:{commodityCode:code},include:{records:true},orderBy:{createdAt:'desc'}}),prisma.sesameProcessing.findMany({where:{commodityCode:code},orderBy:{createdAt:'desc'}})]);
 const locations=await Promise.all(warehouses.filter(w=>warehouseAllowedForCommodity(w.name,code)).map(async w=>({name:w.name,grades:await Promise.all(['Raw','Machine Cleaned'].map(async grade=>({grade,...await processingAvailability(prisma,code,w.name,grade)})))})));
 const daily=new Map<string,{date:string;warehouseName:string;fromType:string;toType:string;inputKg:number;outputKg:number;impuritiesKg:number}>();
 for(const r of history){const date=r.productionDate??pakistanDate(r.createdAt);const key=[date,r.warehouseName,r.fromType,r.toType].join("::");const d=daily.get(key)??{date,warehouseName:r.warehouseName,fromType:r.fromType,toType:r.toType,inputKg:0,outputKg:0,impuritiesKg:0};d.inputKg+=n(r.inputKg);d.outputKg+=n(r.outputKg);d.impuritiesKg+=n(r.impuritiesKg);daily.set(key,d);}
 return {daily:[...daily.values()].sort((a,b)=>b.date.localeCompare(a.date)),warehouses:locations,plans:plans.map(p=>{
  const records=p.records.map(r=>({productionDate:r.productionDate!,inputKg:n(r.inputKg),outputKg:n(r.outputKg),impuritiesKg:n(r.impuritiesKg)}));
  return {...p,reservedKg:n(p.reservedKg),remainingKg:n(p.remainingKg),dailyCapacityKg:n(p.dailyCapacityKg),expectedYieldRatio:n(p.expectedYieldRatio),records:undefined,forecast:processingForecast(records,p.status==='ACTIVE'?n(p.remainingKg):0,n(p.dailyCapacityKg),n(p.expectedYieldRatio))};
 }),history:history.map(r=>({...r,inputKg:n(r.inputKg),outputKg:n(r.outputKg),impuritiesKg:n(r.impuritiesKg),yieldRatio:n(r.yieldRatio)}))};
}
export async function createProcessingPlan(code:string,actor:string,input:z.infer<typeof processingPlanInput>) {
 if(!PROCESSING_ROUTES.some(r=>r.from===input.fromType&&r.to===input.toType))throw new Error('Invalid conversion');
 const locations=await getCompanyWarehouses();
 if(!locations.some(w=>w.name===input.warehouseName)||!warehouseAllowedForCommodity(input.warehouseName,code))throw new Error('Select a Sesame warehouse');
 return prisma.$transaction(async db=>{
  await lockSesameOwnership(db,code);
  const old=await db.sesameProcessingPlan.findUnique({where:{requestKey:input.requestKey}});
  if(old){if(old.commodityCode!==code||old.warehouseName!==input.warehouseName||old.fromType!==input.fromType||old.toType!==input.toType||n(old.reservedKg)!==input.reservedKg)throw new Error('Request already used');return {id:old.id};}
  const stock=await processingAvailability(db,code,input.warehouseName,input.fromType);
  if(input.reservedKg>stock.availableKg+.0001)throw new Error(`Only ${stock.availableKg.toFixed(3)} kg is available after sales, ownership and processing reservations`);
  const p=await db.sesameProcessingPlan.create({data:{...input,commodityCode:code,recordedBy:actor,remainingKg:input.reservedKg}});return {id:p.id};
 },{timeout:20000});
}
export async function recordWarehouseProduction(code:string,actor:string,input:z.infer<typeof dailyProcessingInput>) {
 const sum=Math.round((input.outputKg+input.impuritiesKg)*1000)/1000;
 const d=new Date(input.productionDate+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==input.productionDate||input.productionDate>pakistanDate())throw new Error('Enter a valid production date no later than today');
 return prisma.$transaction(async db=>{
  await lockSesameOwnership(db,code);
  const old=await db.sesameProcessing.findUnique({where:{requestKey:input.requestKey}});
  if(old){if(old.commodityCode!==code||old.planId!==input.planId||old.productionDate!==input.productionDate||n(old.outputKg)!==input.outputKg||n(old.impuritiesKg)!==input.impuritiesKg)throw new Error('Request already used');return {id:old.id};}
  if(await db.sesameProcessing.findFirst({where:{planId:input.planId,productionDate:input.productionDate,automatic:true}}))throw new Error('This day already has automatic production. Edit that entry in production history.');
  const p=await db.sesameProcessingPlan.findUniqueOrThrow({where:{id:input.planId}});
  if(p.commodityCode!==code||p.status!=='ACTIVE')throw new Error('Select an active batch in this desk');
  if(input.productionDate<pakistanDate(p.createdAt))throw new Error('Production date cannot precede the batch');
  if(sum>n(p.remainingKg)+.0001)throw new Error('Daily input exceeds the remaining reserved stock');
  const grades=await sesameGrades(db,code);const available=(grades.find(r=>r.name===p.warehouseName)?.grades[sesameGrade({sesameType:p.fromType})]??0)*1000;
  if(sum>available+.0001)throw new Error('Physical source stock is insufficient');
  const remaining=Math.round((n(p.remainingKg)-sum)*1000)/1000;
  const r=await db.sesameProcessing.create({data:{...input,commodityCode:code,warehouseName:p.warehouseName,fromType:p.fromType,toType:p.toType,inputKg:sum,yieldRatio:sum?input.outputKg/sum:0,recordedBy:actor}});
  await db.sesameProcessingPlan.update({where:{id:p.id},data:{remainingKg:remaining,status:remaining===0?'COMPLETED':'ACTIVE'}});return {id:r.id};
 },{timeout:20000});
}
export async function updateProcessingPlan(code:string,input:{id:string;dailyCapacityKg?:number;expectedYieldRatio?:number;cancel?:boolean}) {
 await settleDailyDefaults(prisma,code);
 return prisma.$transaction(async db=>{await lockSesameOwnership(db,code);const p=await db.sesameProcessingPlan.findUniqueOrThrow({where:{id:input.id}});if(p.commodityCode!==code||p.status!=='ACTIVE')throw new Error('Select an active batch in this desk');await db.sesameProcessingPlan.update({where:{id:p.id},data:input.cancel?{status:'CANCELLED'}:{dailyCapacityKg:input.dailyCapacityKg,expectedYieldRatio:input.expectedYieldRatio}});return {ok:true};});
}

/** Corrections change the grade ledger in-place and retain the original quantities in an audit trail. */
export async function editWarehouseProduction(code:string,actor:string,input:z.infer<typeof editProcessingInput>) {
 const total=Math.round((input.outputKg+input.impuritiesKg)*1000)/1000;
 return prisma.$transaction(async db=>{
  await lockSesameOwnership(db,code);
  const old=await db.sesameProcessing.findUniqueOrThrow({where:{id:input.id}});
  if(old.commodityCode!==code)throw new Error('Select a processing entry in this desk');
  if(old.revision!==input.revision)throw new Error('This entry has changed. Refresh and reopen it before editing.');
  const delta=Math.round((total-n(old.inputKg))*1000)/1000;
  // Never remove output that has already been dispatched, reserved, sold or processed further.
  for(const [grade,reduction] of [[old.toType,n(old.outputKg)-input.outputKg],['Impurities',n(old.impuritiesKg)-input.impuritiesKg]] as const){
   if(reduction>.0001){
    const available=await processingAvailability(db,code,old.warehouseName,grade);
    if(reduction>available.availableKg+.0001)throw new Error(`Cannot reduce ${grade}: that stock has already been used or reserved. Correct the downstream entry first.`);
   }
  }
  const plan=old.planId?await db.sesameProcessingPlan.findUniqueOrThrow({where:{id:old.planId}}):null;
  if(plan){
   if(delta>n(plan.remainingKg)+.0001)throw new Error('Corrected input exceeds the reserved batch quantity');
   if(delta>0){
    const available=await processingAvailability(db,code,old.warehouseName,old.fromType);
    const usable=available.availableKg+(plan.status==='ACTIVE'?n(plan.remainingKg):0);
    if(delta>usable+.0001)throw new Error('Insufficient unreserved source stock for this correction');
   }
  } else if(delta>0){
   const available=await processingAvailability(db,code,old.warehouseName,old.fromType);
   if(delta>available.availableKg+.0001)throw new Error('Insufficient unreserved source stock for this correction');
   if(old.transferId){
    const transfer=await db.stockTransfer.findUniqueOrThrow({where:{id:old.transferId}});
    const used=await db.sesameProcessing.aggregate({where:{transferId:old.transferId},_sum:{inputKg:true}});
    if(n(used._sum.inputKg)+delta>n(transfer.receivedQtyMt??transfer.dispatchedQtyMt)*1000+.0001)throw new Error('Corrected input exceeds the quantity received on the processing truck');
   }
  }
  const now=new Date();
  const history=Array.isArray(old.editHistory)?old.editHistory:[];
  await db.sesameProcessing.update({where:{id:old.id},data:{inputKg:total,outputKg:input.outputKg,impuritiesKg:input.impuritiesKg,yieldRatio:total?input.outputKg/total:0,revision:{increment:1},editedBy:actor,editedAt:now,editHistory:[...history,{revision:old.revision,inputKg:n(old.inputKg),outputKg:n(old.outputKg),impuritiesKg:n(old.impuritiesKg),editedBy:actor,editedAt:now.toISOString(),reason:input.reason}] as Prisma.InputJsonValue}});
  if(plan){
   const remaining=Math.round((n(plan.remainingKg)-delta)*1000)/1000;
   // Cancelling a batch releases its reservation; editing its history must not silently restart it.
   await db.sesameProcessingPlan.update({where:{id:plan.id},data:{remainingKg:remaining,status:plan.status==='CANCELLED'?'CANCELLED':remaining===0?'COMPLETED':'ACTIVE',...(plan.status==='COMPLETED'&&remaining>0?{nextProductionDate:pakistanDate()}:{} )}});
  }
  return {id:old.id};
 },{timeout:20000});
}

/** Called under the shared ownership lock by booking/edit/allocation writes. */
export async function guardProcessingSale(db:Prisma.TransactionClient,input:{code:string;direction:string;params:unknown;quantity:number;unit:string;tradeRef?:string;status?:string;allocations?:{warehouseName:string;openQtyMt:number}[]}) {
 const params=(input.params??{}) as Record<string,unknown>;
 const selected=String(params.warehouseSelections??'').split(/[,;|]/).map(s=>s.trim()).filter(Boolean);
 for(const w of selected)if(!warehouseAllowedForCommodity(w,input.code))throw new Error('Faqir Warehouse is not available for Sesame');
 const entity=tradeEntity(input.params);const pakSale=(input.direction==='SELL'&&entity==='PAK')||(input.direction==='BUY'&&entity==='FZCO'&&params.internalCounterpartyEntity==='PAK');
 if(!pakSale||['CANCELLED','REJECTED','SETTLED','EXECUTED'].includes(input.status??''))return;
 const grade=sesameGrade(input.params);
 const plans=await db.sesameProcessingPlan.findMany({where:{commodityCode:input.code,status:'ACTIVE',fromType:grade}});
 if(!plans.length)return;
 const {parseExecutionWarehouseSplit}=await import('@/lib/warehouse-allocation');
 const lines=input.allocations??parseExecutionWarehouseSplit(params as Record<string,string|number|null>);
 const names=lines.length?lines.map(l=>l.warehouseName):selected;
 for(const name of names)if(!warehouseAllowedForCommodity(name,input.code))throw new Error("Faqir Warehouse is not available for Sesame");
 if(!names.length)throw new Error('Select warehouse stock for this sale; some inventory is reserved for processing');
 let total=0;
 for(const name of names){
  const stock=await processingAvailability(db,input.code,name,grade,input.tradeRef);
  const line=lines.find(l=>l.warehouseName===name);
  if(line&&plans.some(p=>p.warehouseName.toLowerCase()===name.toLowerCase())&&quantityUnitToKg(line.openQtyMt,input.unit)>stock.availableKg+.0001)throw new Error(`Stock at ${name} is locked in processing or already booked`);
  total+=stock.availableKg;
 }
 if(names.some(name=>plans.some(p=>p.warehouseName.toLowerCase()===name.toLowerCase()))&&quantityUnitToKg(input.quantity,input.unit)>total+.0001)throw new Error('This sale would use stock locked in processing');
}
