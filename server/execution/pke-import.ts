import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { pkeImportSale, tradeEntity, internalEntity } from "@/lib/sesame-entity";
import { lcBypassBlocksPayment, pkeReceiptProgress, type PkeImportPayload } from "@/lib/pke-import";
/** A physical receipt exists once, in Pakistan. This link fulfills only the supplier book. */
export async function linkPkeTripartyReceipt(input:{id:string;revision?:number;receiptId:string;saleTradeRef:string},actor:string){
 return prisma.$transaction(tx=>linkPkeTripartyReceiptTx(tx,input,actor));
}
export async function linkPkeTripartyReceiptTx(tx:Prisma.TransactionClient,input:{id:string;revision?:number;receiptId:string;saleTradeRef:string},actor:string){
  await tx.$queryRaw`SELECT id FROM "PkeImportFile" WHERE id=${input.id} FOR UPDATE`;
  const file=await tx.pkeImportFile.findUniqueOrThrow({where:{id:input.id}});
  if(input.revision!==undefined && file.revision!==input.revision)throw new Error("This import file changed. Refresh and retry");
  // Lock both contracts in consistent order, including across different shipment files.
  const refs=[file.purchaseTradeRef,input.saleTradeRef].sort();
  for(const ref of refs)await tx.$queryRaw`SELECT id FROM "ExecutionContract" WHERE "tradeRef"=${ref} FOR UPDATE`;
  const purchase=await tx.trade.findUniqueOrThrow({where:{tradeRef:file.purchaseTradeRef},include:{commodity:true,contract:true}});
  const sale=await tx.trade.findUniqueOrThrow({where:{tradeRef:input.saleTradeRef},include:{commodity:true,contract:true}});
  if(purchase.commodity.code!=="PKE"||purchase.direction!=="BUY"||tradeEntity(purchase.tradeParams)!=="FZCO"||internalEntity(purchase.tradeParams)||!purchase.contract||!["LOCKED","CONFIRMED","EXECUTED"].includes(purchase.tradeStatus)||purchase.directSettled)throw new Error("Select an open, locked FZCO supplier purchase");
  if(!pkeImportSale(sale.commodity.code,sale.direction,sale.tradeParams)||!sale.contract||!["LOCKED","EXECUTED"].includes(sale.tradeStatus)||sale.directSettled)throw new Error("Select a locked PKE Dubai sale to Pakistan");
  const payload=file.payload as unknown as PkeImportPayload;
  const savedSale=payload.references["Dubai sale trade reference"];
  if(savedSale&&savedSale!==sale.tradeRef)throw new Error("Receipt must belong to this import file's Dubai sale");
  await tx.$queryRaw`SELECT id FROM "InboundReceipt" WHERE id=${input.receiptId} FOR UPDATE`;
  const receipt=await tx.inboundReceipt.findUniqueOrThrow({where:{id:input.receiptId},include:{gatepassTruck:true,pkeTripartyReceipt:true}});
  if(receipt.tradeRef!==sale.tradeRef||receipt.status==="DRAFT"||!receipt.gatepassTruck||receipt.gatepassTruck.executionEntity!=="PAK"||receipt.gatepassTruck.commodityCode!=="PKE"||receipt.gatepassTruck.movementType!=="INBOUND"||receipt.gatepassTruck.status!=="ASSIGNED"||receipt.pkeTripartyReceipt)throw new Error("Choose an allocated, unlinked Pakistan gate-in for this Dubai sale");
  const portState=(await (await import('./pke-port')).pkePortRows(tx)).find(f=>f.id===file.id);
  if(!portState?.vessel||!portState.arrivalDate)throw new Error('Record vessel arrival in Import Files before triparty gate-in');
  if(Number(receipt.allocatedQtyMt)>portState.freeMt+.000001)throw new Error('Gate-in exceeds unbooked stock remaining at the port');
  const received=await tx.pkeTripartyReceipt.aggregate({where:{purchaseTradeRef:purchase.tradeRef},_sum:{quantityMt:true}});
  const prior=Number(received._sum.quantityMt??0),qty=Number(receipt.allocatedQtyMt),total=Number(purchase.contract.contractualQtyMt);
  if(purchase.contract.quantityUnit!=="MT"||sale.contract.quantityUnit!=="MT")throw new Error("PKE import trades must be booked in MT");
  const portSold=await tx.pkePortMovement.aggregate({where:{kind:'PORT_SALE',importFile:{purchaseTradeRef:purchase.tradeRef}},_sum:{quantityMt:true}});
  const progress=pkeReceiptProgress(total,prior+Number(portSold._sum.quantityMt??0),qty);
  await tx.pkeTripartyReceipt.create({data:{importFileId:file.id,receiptId:receipt.id,purchaseTradeRef:purchase.tradeRef,saleTradeRef:sale.tradeRef,quantityMt:qty,createdBy:actor}});
  await tx.pkePortMovement.create({data:{requestKey:`receipt:${receipt.id}`,importFileId:file.id,kind:'WAREHOUSE',quantityMt:qty,receiptId:receipt.id,truckId:receipt.gatepassTruck.id,createdBy:actor}});
  const {open}=progress;
  await tx.executionContract.update({where:{id:purchase.contract.id},data:{receivedQtyMt:progress.received,openQtyMt:open,closeOnPayment:true}});

  payload.references["Dubai sale trade reference"]=sale.tradeRef;
  payload.history.push({at:new Date().toISOString(),actor,action:`Triparty gate-in ${receipt.gatepassNo}: ${qty} MT · Supplier purchase ${purchase.tradeRef} · Dubai sale / Pakistan purchase ${sale.tradeRef}. Payment balances unchanged.`});
  await tx.pkeImportFile.update({where:{id:file.id},data:{payload:JSON.parse(JSON.stringify(payload)),revision:{increment:1}}});
  const saleReceived=await tx.inboundReceipt.aggregate({where:{tradeRef:sale.tradeRef,status:{not:"DRAFT"}},_sum:{allocatedQtyMt:true}});
  const internalPortSold=await tx.pkePortMovement.aggregate({where:{kind:'PORT_SALE',importFile:{payload:{path:['references','Dubai sale trade reference'],equals:sale.tradeRef}}},_sum:{quantityMt:true}});
  const saleQty=Number(saleReceived._sum.allocatedQtyMt??0)+Number(internalPortSold._sum.quantityMt??0),saleOpen=Math.max(0,Number(sale.contract.contractualQtyMt)-saleQty);
  await tx.executionContract.update({where:{id:sale.contract.id},data:{receivedQtyMt:saleQty,openQtyMt:saleOpen,closeOnPayment:true}});

  return {ok:true};
}
export async function assertPkeLcPaymentAllowed(tx:Prisma.TransactionClient,tradeRef:string){
 const trade=await tx.trade.findUnique({where:{tradeRef},include:{commodity:true}});
 if(trade?.commodity.code!=="PKE"||trade.paymentType!=="LC")return;
 const files=await tx.pkeImportFile.findMany({where:{OR:[{purchaseTradeRef:tradeRef},{payload:{path:["references","Dubai sale trade reference"],equals:tradeRef}}]}});
 for(const candidate of files) {
  await tx.$queryRaw`SELECT id FROM "PkeImportFile" WHERE id=${candidate.id} FOR UPDATE`;
  const file=await tx.pkeImportFile.findUniqueOrThrow({where:{id:candidate.id}});
  const payload=file.payload as unknown as PkeImportPayload;
  const side=pkeImportSale('PKE',trade.direction,trade.tradeParams)?'PAK_DUBAI':'DUBAI_SUPPLIER';
  const ids=new Set((payload.lcs??[]).filter(l=>l.side===side).map(l=>l.id));
  if(lcBypassBlocksPayment({...payload,bypasses:payload.bypasses?.filter(b=>ids.has(b.lcId))}))throw new Error(`LC document bypass for ${file.title} requires execution-head approval before payment. Changed LC terms require a new request.`);
 }
}
