import { processingReservedKg } from "./processing-reservations";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { inboundStockDelta, outboundStockDelta, stockTransferDelta } from "@/lib/inventory-stock";
import { tradeEntity } from "@/lib/sesame-entity";
import { emptyGrades, sesameGrade, processingYield, PROCESSING_ROUTES } from "@/lib/sesame-processing";
import { lockSesameOwnership, pakistanAvailable } from "./sesame-stock";
type DB = Prisma.TransactionClient;
const n = (v: unknown) => Number(v ?? 0);

/** Grade ledger is derived from the same movements as physical inventory. Conversion conserves mass. */
export async function sesameGrades(db: DB, code: string) {
  const [ins, outs, shifts, batches, pending, plans] = await Promise.all([
    db.inboundReceipt.findMany({ where: { trade: { commodity: { code } } }, include: { trade: { select: { tradeParams: true } } } }),
    db.outboundDispatch.findMany({ where: { trade: { commodity: { code } } }, include: { trade: { select: { tradeParams: true } } } }),
    db.stockTransfer.findMany({ where: { commodityCode: code } }),
    db.sesameProcessing.findMany({ where: { commodityCode: code }, orderBy: { createdAt: "desc" } }),
    db.pendingTruck.findMany({ where: { commodityCode: code, movementType: "INBOUND", status: { not: "ASSIGNED" } } }),
    db.sesameProcessingPlan.findMany({where:{commodityCode:code,status:"ACTIVE"},select:{warehouseName:true,remainingKg:true}}),
  ]);
  const map = new Map<string, { name: string; grades: ReturnType<typeof emptyGrades>; unclassifiedMt: number }>();
  const row = (name: string) => { const key = name.trim().toLowerCase(); if (!map.has(key)) map.set(key, { name, grades: emptyGrades(), unclassifiedMt: 0 }); return map.get(key)!; };
  const add = (name: string, grade: string, qty: number) => { row(name).grades[sesameGrade({ sesameType: grade })] += qty; };
  for (const r of ins) add(r.warehouseName, sesameGrade(r.trade.tradeParams), inboundStockDelta(r.status,n(r.allocatedQtyMt)));
  for (const r of outs) add(r.warehouseName, sesameGrade(r.trade.tradeParams), outboundStockDelta(r.status,n(r.allocatedQtyMt)));
  for (const t of shifts) for (const wh of new Set([t.fromWarehouseName,t.toWarehouseName])) if (wh) add(wh,t.sesameType,stockTransferDelta(wh,{...t,dispatchedQtyMt:n(t.dispatchedQtyMt),receivedQtyMt:t.receivedQtyMt == null ? null : n(t.receivedQtyMt)}));
  for (const p of pending) row(p.warehouseName).unclassifiedMt += n(p.remainingKg)/1000;
  for (const b of batches) { add(b.warehouseName,b.fromType,-n(b.inputKg)/1000); add(b.warehouseName,b.toType,n(b.outputKg)/1000); add(b.warehouseName,"Impurities",n(b.impuritiesKg)/1000); }
  return [...map.values()].map(r => ({ ...r, processingReservedMt:plans.filter(p=>p.warehouseName.trim().toLowerCase()===r.name.trim().toLowerCase()).reduce((s,p)=>s+n(p.remainingKg)/1000,0), sesameStockMt: Object.values(r.grades).reduce((a,b)=>a+b,0)+r.unclassifiedMt }));
}
export async function assertGradeAvailable(db: DB, code: string, warehouse: string, grade: string, qtyMt: number) {
  const rows = await sesameGrades(db,code);
  const available = rows.find(r => r.name.trim().toLowerCase() === warehouse.trim().toLowerCase())?.grades[sesameGrade({sesameType:grade})] ?? 0;
  const [entries, reserved] = await Promise.all([
    db.sesameOwnershipEntry.findMany({where:{commodityCode:code,warehouseName:{equals:warehouse,mode:"insensitive"}},include:{trade:{select:{tradeParams:true}}}}),
    db.outboundDispatch.findMany({where:{warehouseName:{equals:warehouse,mode:"insensitive"},status:"AT_GATE",trade:{commodity:{code}}},include:{trade:{select:{tradeParams:true}}}}),
  ]);
  const custody = entries.filter(e=>sesameGrade(e.trade.tradeParams)===grade).reduce((sum,e)=>sum+(e.toEntity==="FZCO"?n(e.quantityMt):0)-(e.fromEntity==="FZCO"?n(e.quantityMt):0),0);
  const reservedMt = reserved.filter(r=>tradeEntity(r.trade.tradeParams)==="PAK" && sesameGrade(r.trade.tradeParams)===grade).reduce((sum,r)=>sum+n(r.allocatedQtyMt),0);
  if (qtyMt > Math.max(0,available-custody-reservedMt-await processingReservedKg(db,code,warehouse,grade)/1000)+0.000001) throw new Error(`Insufficient unreserved Pakistan-owned ${grade} at ${warehouse}`);
}
export async function recordProcessing(input: { code: string; transferId: string; toType: string; inputKg: number; yieldRatio: number; requestKey: string; actor: string }) {
  const amounts = processingYield(input.inputKg,input.yieldRatio);
  return prisma.$transaction(async db => {
    await lockSesameOwnership(db,input.code);
    const existing = await db.sesameProcessing.findUnique({where:{requestKey:input.requestKey}});
    if (existing) {
      if (existing.commodityCode !== input.code || existing.transferId !== input.transferId || existing.toType !== input.toType || n(existing.inputKg) !== amounts.inputKg || n(existing.yieldRatio) !== input.yieldRatio) throw new Error("This request was already used for a different processing record");
      return { id: existing.id };
    }
    await db.$queryRaw`SELECT "id" FROM "StockTransfer" WHERE "id" = ${input.transferId} FOR UPDATE`;
    const t = await db.stockTransfer.findUniqueOrThrow({where:{id:input.transferId}});
    if (t.commodityCode !== input.code || t.purpose !== "PROCESSING" || t.status !== "RECEIVED") throw new Error("Receive the internal processing truck before recording its yield");
    if (!PROCESSING_ROUTES.some(r=>r.from===t.sesameType && r.to===input.toType)) throw new Error("Choose Raw to Machine Cleaned, Raw to Sortex, or Machine Cleaned to Sortex");
    const used = await db.sesameProcessing.aggregate({where:{transferId:t.id},_sum:{inputKg:true}});
    if (n(used._sum.inputKg)+amounts.inputKg > n(t.receivedQtyMt)*1000+0.000001) throw new Error("Input exceeds the unprocessed quantity received on this truck");
    await assertGradeAvailable(db,input.code,t.toWarehouseName,t.sesameType,amounts.inputKg/1000);
    if (await pakistanAvailable(db,input.code,t.toWarehouseName)+0.000001 < amounts.inputKg/1000) throw new Error("Stock is reserved or owned by FZCO");
    const saved = await db.sesameProcessing.create({data:{requestKey:input.requestKey,transferId:t.id,commodityCode:input.code,warehouseName:t.toWarehouseName,fromType:t.sesameType,toType:input.toType,...amounts,yieldRatio:input.yieldRatio,recordedBy:input.actor}});
    return { id: saved.id };
  });
}
