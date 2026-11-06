import {warehouseAllowedForCommodity} from "@/lib/warehouse-eligibility";
import {prisma} from '@/server/db';
import type {Prisma} from '@prisma/client';
import {pkeImportSale,tradeEntity} from '@/lib/sesame-entity';
import {nextSerial,SERIALS} from '@/server/db/serials';
import {linkPkeTripartyReceiptTx} from './pke-import';
import {postTruckLedgerDebit} from '@/server/finance/ledger';
import {getFinancePolicy} from '@/server/finance/policy';
import {advanceTaxOn,advanceTaxRateFor} from '@/lib/finance-policy';
import type {PkeImportPayload} from '@/lib/pke-import';
const n=(v:unknown)=>Number(v??0);
export const portLocation=(id:string,port:string,vessel:string)=>`Port: ${port} · ${vessel} [${id}]`;
export const portFileId=(params:unknown)=>String((params as Record<string,unknown>|null)?.pkePortFileId??'');
export async function pkePortRows(db:Prisma.TransactionClient=prisma){
 const files=await db.pkeImportFile.findMany({include:{portMovements:true},orderBy:{createdAt:'desc'}});
 const shifts=await db.stockTransfer.findMany({where:{commodityCode:'PKE',status:{in:['IN_TRANSIT','RECEIVED']}}});
 const trades=await db.trade.findMany({where:{commodity:{code:'PKE'},tradeStatus:{not:'CANCELLED'}},include:{contract:true,counterparty:true}});
 return files.map(f=>{
  const refs=(f.payload as unknown as PkeImportPayload).references;
  const quantity=n(refs['Vessel received MT']);
  const location=portLocation(f.id,refs['Arrival port']??'',refs['Vessel name']??'');
  const shifted=shifts.filter(s=>s.fromWarehouseName===location).reduce((a,s)=>a+n(s.dispatchedQtyMt),0);
  const moved=f.portMovements.reduce((s,m)=>s+n(m.quantityMt),0)+shifted;
  const sales=trades.filter(t=>portFileId(t.tradeParams)===f.id&&t.direction==='SELL');
  const booked=sales.reduce((s,t)=>s+Math.max(0,n(t.quantity)-f.portMovements.filter(m=>m.saleTradeRef===t.tradeRef).reduce((a,m)=>a+n(m.quantityMt),0)),0);
  return {location,id:f.id,title:f.title,purchaseTradeRef:f.purchaseTradeRef,saleTradeRef:refs['Dubai sale trade reference']??'',blNo:refs['Bill of lading']??'',vessel:refs['Vessel name']??'',port:refs['Arrival port']??'',arrivalDate:refs['Vessel arrival date']??'',quantityMt:quantity,warehouseMt:f.portMovements.filter(m=>m.kind==='WAREHOUSE').reduce((s,m)=>s+n(m.quantityMt),0),soldMt:f.portMovements.filter(m=>m.kind==='PORT_SALE').reduce((s,m)=>s+n(m.quantityMt),0),remainingMt:Math.max(0,quantity-moved),freeMt:Math.max(0,quantity-moved-booked),sales:sales.map(t=>({tradeRef:t.tradeRef,buyer:t.counterparty.name,quantityMt:n(t.quantity),locked:!!t.contract&&['LOCKED','CONFIRMED','EXECUTED'].includes(t.tradeStatus),remainingMt:Math.max(0,n(t.quantity)-f.portMovements.filter(m=>m.saleTradeRef===t.tradeRef).reduce((s,m)=>s+n(m.quantityMt),0))}))};
 });
}
export async function guardPkePortBooking(db:Prisma.TransactionClient,input:{code:string;direction:string;params:unknown;quantity:number;tradeScope?:string;excludeRef?:string}){
 const id=portFileId(input.params);if(!id)return;
 if(input.code!=='PKE'||input.direction!=='SELL'||tradeEntity(input.params)!=='PAK'||input.tradeScope!=='LOCAL')throw new Error('Port stock is available only for local Pakistan PKE sales');
 await db.$queryRaw`SELECT id FROM "PkeImportFile" WHERE id=${id} FOR UPDATE`;
 const row=(await pkePortRows(db)).find(f=>f.id===id);
 if(!row?.vessel||!row.arrivalDate||row.quantityMt<=0)throw new Error('Record vessel arrival before selling from the port');
 const source=await db.trade.findUniqueOrThrow({where:{tradeRef:row.purchaseTradeRef}});if(source.tradeStatus==='CANCELLED')throw new Error('Import purchase cancelled');
 const own=row.sales.find(s=>s.tradeRef===input.excludeRef);
 if(input.quantity>row.freeMt+(own?.quantityMt??0)+.000001)throw new Error('Sale exceeds unbooked PKE stock at this port');
}
export async function recordPkePortMovement(input:{fileId:string;kind:'WAREHOUSE'|'PORT_SALE';quantityMt:number;truckNo:string;builty:string;warehouse?:string;transporterName?:string;saleTradeRef?:string;requestKey:string},actor:string){
 const policy=await getFinancePolicy();
 const result=await prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "PkeImportFile" WHERE id=${input.fileId} FOR UPDATE`;
  const previous=await tx.pkePortMovement.findUnique({where:{requestKey:input.requestKey}});
  if(previous){if(previous.importFileId!==input.fileId||n(previous.quantityMt)!==input.quantityMt||previous.kind!==input.kind)throw new Error('Request already used');return {truckId:previous.truckId};}
  const file=await tx.pkeImportFile.findUniqueOrThrow({where:{id:input.fileId}});
  const refs=(file.payload as unknown as PkeImportPayload).references;
  const state=(await pkePortRows(tx)).find(f=>f.id===input.fileId)!;
  if(!state.vessel||!state.arrivalDate||!state.blNo)throw new Error('Record the vessel arrival and BL first');
  if(!Number.isFinite(input.quantityMt)||input.quantityMt<=0||input.quantityMt>state.remainingMt+.000001)throw new Error('Movement exceeds stock remaining at port');
  if(input.kind==='WAREHOUSE'&&input.quantityMt>state.freeMt+.000001)throw new Error('This stock is reserved for port sales; only unbooked port stock can enter a warehouse');
  const internal=await tx.trade.findUniqueOrThrow({where:{tradeRef:state.saleTradeRef},include:{contract:true,commodity:true,counterparty:true}});
  if(!internal.contract||!pkeImportSale('PKE',internal.direction,internal.tradeParams))throw new Error('Link and lock the Dubai sale / Pakistan purchase first');
  const trade=input.kind==='WAREHOUSE'?internal:await tx.trade.findUniqueOrThrow({where:{tradeRef:input.saleTradeRef},include:{contract:true,commodity:true,counterparty:true}});
  for(const ref of [file.purchaseTradeRef,internal.tradeRef,trade.tradeRef].sort())await tx.$queryRaw`SELECT id FROM "ExecutionContract" WHERE "tradeRef"=${ref} FOR UPDATE`;
  if(!trade.contract||!['LOCKED','CONFIRMED','EXECUTED'].includes(trade.tradeStatus))throw new Error('Lock the selected trade first');
  if(input.kind==='PORT_SALE'&&(trade.direction!=='SELL'||trade.commodity.code!=='PKE'||trade.tradeScope!=='LOCAL'||tradeEntity(trade.tradeParams)!=='PAK'||portFileId(trade.tradeParams)!==file.id))throw new Error('Select a local PKE sale booked against this vessel');
  if(input.kind==='PORT_SALE'&&input.quantityMt>(state.sales.find(t=>t.tradeRef===trade.tradeRef)?.remainingMt??0)+.000001)throw new Error('Movement exceeds the local sale contract');
  const supplier=await tx.trade.findUniqueOrThrow({where:{tradeRef:file.purchaseTradeRef},include:{contract:true}});
  if(supplier.tradeStatus==='CANCELLED'||internal.tradeStatus==='CANCELLED')throw new Error('The import was cancelled');
  if(!supplier.contract)throw new Error('Lock the supplier purchase first');
  // All BLs under the same internal contract share its quantity limit.
  const related=await tx.pkeImportFile.findMany({where:{payload:{path:['references','Dubai sale trade reference'],equals:internal.tradeRef}},select:{id:true}});
  const portSold=await tx.pkePortMovement.aggregate({where:{importFileId:{in:related.map(f=>f.id)},kind:'PORT_SALE'},_sum:{quantityMt:true}});
  const received=await tx.inboundReceipt.aggregate({where:{tradeRef:internal.tradeRef,status:{not:'DRAFT'}},_sum:{allocatedQtyMt:true}});
  if(n(portSold._sum.quantityMt)+n(received._sum.allocatedQtyMt)+input.quantityMt>n(internal.quantity)+.000001)throw new Error('Port sales plus warehouse receipts exceed the Dubai sale / Pakistan purchase contract');
  let warehouse=state.location;
  if(input.kind==='WAREHOUSE'){
   warehouse=input.warehouse?.trim()??'';
   const allowed=await tx.location.findFirst({where:{name:warehouse,type:"WAREHOUSE"}});
   if(!allowed||!warehouse||!warehouseAllowedForCommodity(warehouse,'PKE'))throw new Error('Select a registered destination warehouse');
  }
  const kg=input.quantityMt*1000;
  const gatepassNo=await nextSerial(input.kind==='WAREHOUSE'?SERIALS.GATEPASS_INBOUND:SERIALS.GATEPASS_OUTBOUND,tx);
  const base=Math.round(kg*n(trade.contract.ratePerKg)*100)/100;
  const tax=input.kind==='PORT_SALE'?advanceTaxOn(base,advanceTaxRateFor(policy,trade.counterparty.taxFilerStatus)):0;
  const truck=await tx.pendingTruck.create({data:{gatepassNo,arrivalDate:new Date(),movementType:input.kind==='WAREHOUSE'?'INBOUND':'OUTBOUND',status:'ASSIGNED',warehouseName:warehouse,truckNo:input.truckNo,counterpartyName:trade.counterparty.name,commodityCode:'PKE',commodityName:'PKE',executionEntity:'PAK',recordedByName:actor,transporterName:input.transporterName,builtyDetails:input.builty,weightKg:kg,weightAsPerBuiltyKg:kg,warehouseWeightKg:input.kind==='WAREHOUSE'?kg:null,remainingKg:0,assignedTradeRef:trade.tradeRef,assignedAt:new Date(),remarks:`Vessel ${state.vessel} · BL ${state.blNo}`,...(input.kind==='PORT_SALE'?{saleBasePkr:base,saleTaxPkr:tax,saleExpectedPkr:base+tax,saleStage:'AWAITING_BALANCE' as const}:{})}});
  let receiptId:string|undefined;
  if(input.kind==='WAREHOUSE'){
   const receipt=await tx.inboundReceipt.create({data:{kcsNo:await nextSerial(SERIALS.INBOUND,tx),gatepassNo,tradeRef:trade.tradeRef,receiveDate:new Date(),truckNo:input.truckNo,biltyNo:input.builty,trnNo:gatepassNo,warehouseName:warehouse,sellerName:trade.counterparty.name,weightSpotKg:kg,weightWarehouseKg:kg,weightDiffKg:0,allocatedQtyMt:input.quantityMt,status:'ALLOCATED'}});
   receiptId=receipt.id;
   await linkPkeTripartyReceiptTx(tx,{id:file.id,receiptId:receipt.id,saleTradeRef:internal.tradeRef},actor);
   await tx.pkePortMovement.update({where:{receiptId:receipt.id},data:{requestKey:input.requestKey}});
  }else{
   await tx.outboundDispatch.create({data:{gatepassNo,tradeRef:trade.tradeRef,dispatchDate:new Date(),liftedBy:trade.counterparty.name,buyerName:trade.counterparty.name,warehouseName:warehouse,truckNo:input.truckNo,dispatchWeightKg:kg,invoiceWeightKg:kg,allocatedQtyMt:input.quantityMt,amountDue:base+tax,status:'WEIGHED'}});
   await postTruckLedgerDebit({truckId:truck.id,gatepassNo,tradeRef:trade.tradeRef,counterpartyId:trade.counterpartyId,amountPkr:base+tax,side:'SELL',note:`PKE port sale · BL ${state.blNo} · Vessel ${state.vessel}`},tx);
  }
  if(input.kind==='PORT_SALE')await tx.pkePortMovement.create({data:{requestKey:input.requestKey,importFileId:file.id,kind:input.kind,quantityMt:input.quantityMt,saleTradeRef:input.kind==='PORT_SALE'?trade.tradeRef:null,receiptId,truckId:truck.id,createdBy:actor}});
  return {truckId:truck.id,gatepassNo};
 });
 const file=await prisma.pkeImportFile.findUniqueOrThrow({where:{id:input.fileId}});
 const refs=(file.payload as unknown as PkeImportPayload).references;
 const {refreshContract}=await import('./contracts');
 for(const ref of new Set([file.purchaseTradeRef,refs['Dubai sale trade reference'],input.saleTradeRef].filter((v):v is string=>!!v)))await refreshContract(ref);
 return result;
}
