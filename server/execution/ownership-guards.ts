import { prisma } from "@/server/db";
import { TRPCError } from "@trpc/server";
import { isSesameCommodity } from "@/lib/sesame";
import { fzcoCustody } from "./sesame-stock";

async function assertProcessingSource(code:string,warehouse:string) {
 if(!isSesameCommodity(code))return;
 const where={commodityCode:code,warehouseName:{equals:warehouse,mode:"insensitive" as const}};
 if(await prisma.sesameProcessingPlan.count({where:{...where,status:"ACTIVE"}})||await prisma.sesameProcessing.count({where}))throw new TRPCError({code:"BAD_REQUEST",message:"This warehouse has reserved or processed stock. Its source stock movements cannot be changed after processing; record a separate correction movement."});
}
/** Paper ownership is changed by journal entries and releases, never by editing movements. */
export async function assertOwnershipWrite(path: string, raw: unknown): Promise<void> {
  if(!path.startsWith("sesameExport.")&&raw&&typeof raw==='object'&&/(update|delete|cancel|close|settle|allocate|assign|release|approve|generate|confirm)/i.test(path)){
    const input=raw as Record<string,unknown>;
    if(typeof input.tradeRef==='string'&&/(cancel|close|settle|delete)/i.test(path)&&await prisma.sesameExportShipment.count({where:{tradeRef:input.tradeRef}}))throw new TRPCError({code:'BAD_REQUEST',message:'This trade has export shipment records; resolve its shipment and BL accounting before changing its lifecycle'});
    const truckId=typeof input.truckId==='string'?input.truckId:/GateEntry|PendingTruck/.test(path)&&typeof input.id==='string'?input.id:null;
    if(truckId&&(await prisma.pendingTruck.findUnique({where:{id:truckId},select:{exportShipmentId:true}}))?.exportShipmentId)throw new TRPCError({code:'BAD_REQUEST',message:'Use the grouped Sesame export shipment workflow'});
    const dispatchId=typeof input.dispatchId==='string'?input.dispatchId:/OutboundDispatch/.test(path)&&typeof input.id==='string'?input.id:null;
    if(dispatchId){const d=await prisma.outboundDispatch.findUnique({where:{id:dispatchId},select:{gatepassNo:true}});if(d?.gatepassNo&&(await prisma.pendingTruck.findUnique({where:{gatepassNo:d.gatepassNo},select:{exportShipmentId:true}}))?.exportShipmentId)throw new TRPCError({code:'BAD_REQUEST',message:'Use the grouped Sesame export shipment workflow'});}
  }
  if (path.startsWith("sesameExecution.") || !/(update|delete|cancel|close|settle|allocate|advanceSpot|submitSpot)/i.test(path) || !raw || typeof raw !== "object") return;
  const input = raw as Record<string, unknown>;
  const fail = () => { throw new TRPCError({ code: "BAD_REQUEST", message: "Use the Sesame ownership workflow. A confirmed ownership record cannot be changed through physical-stock edits or settlement." }); };
  if (input.patch) await assertOwnershipWrite(path, input.patch);
  if (input.payload) await assertOwnershipWrite(path, input.payload);
  const tradeRef = typeof input.tradeRef === "string" ? input.tradeRef : input.entityType === "TRADE" && typeof input.entityRef === "string" ? input.entityRef : null;
  if (tradeRef) {
    const c = await prisma.executionContract.findUnique({ where: { tradeRef }, select: { paperOwnership: true } });
    if (c?.paperOwnership) fail();
  }
  const id = typeof input.id === "string" ? input.id : null;
  const truckId = typeof input.truckId === "string" ? input.truckId : /GateEntry|PendingTruck/.test(path) ? id : null;
  if (truckId) {
    const t = await prisma.pendingTruck.findUnique({ where: { id: truckId } });
    if (t?.executionEntity === "FZCO") fail();
    if(t?.commodityCode && t.movementType === "INBOUND")await assertProcessingSource(t.commodityCode,t.warehouseName);
    if (t?.commodityCode && isSesameCommodity(t.commodityCode) && (await fzcoCustody(prisma, t.commodityCode)).get(t.warehouseName)) fail();
  }
  for (const inbound of [true, false]) {
    const key = inbound ? "receiptId" : "dispatchId";
    const movementId = typeof input[key] === "string" ? input[key] as string : (inbound ? /InboundReceipt/ : /OutboundDispatch/).test(path) ? id : null;
    if (!movementId) continue;
    const select = { tradeRef: true, warehouseName: true, trade: { select: { commodity: { select: { code: true } }, contract: { select: { paperOwnership: true } } } } } as const;
    const m = inbound ? await prisma.inboundReceipt.findUnique({ where: { id: movementId }, select }) : await prisma.outboundDispatch.findUnique({ where: { id: movementId }, select });
    if (m?.trade.contract?.paperOwnership) fail();
    if(m && inbound)await assertProcessingSource(m.trade.commodity.code,m.warehouseName);
    if (m && isSesameCommodity(m.trade.commodity.code) && (await fzcoCustody(prisma, m.trade.commodity.code)).get(m.warehouseName)) fail();
  }
}
