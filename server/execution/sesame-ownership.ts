import {custodyRows,assertCustody} from './fzco-custody';
import { sesameGrades, assertGradeAvailable } from "./sesame-processing";
import { sesameGrade } from "@/lib/sesame-processing";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { tradeEntity, internalEntity, ownershipSides, sesameBookQty, type SesameEntity } from "@/lib/sesame-entity";
import { isSesameCommodity } from "@/lib/sesame";
import { refreshContract } from "./contracts";
import { postTruckLedgerDebit } from "@/server/finance/ledger";
import { getSeasonNetPositions } from "@/server/net-position";

type DB = Prisma.TransactionClient;
const n = (v: unknown) => Number(v ?? 0);
import { lockSesameOwnership, fzcoCustody, reservedFzco, physicalStock, pakistanAvailable } from "./sesame-stock";
import { processingReservedKg } from "./processing-reservations";
import { bookedPakistanSaleKgAtWarehouse, unassignedPakistanSaleMt } from "./sesame-sale-reservation";

export async function confirmOwnership(input: { tradeRef: string; quantityMt: number; warehouseName?: string; entity: SesameEntity; actor: string; holderId?: string; holderLocation?: string; documentRef?: string; ownershipDate?: Date; requestKey?: string }) {
  await prisma.$transaction(async db => {
    const t = await db.trade.findUniqueOrThrow({ where: { tradeRef: input.tradeRef }, include: { commodity: true, contract: true } });
    const contract = t.contract;
    if (!isSesameCommodity(t.commodity.code) || !contract?.paperOwnership || !["LOCKED","EXECUTED"].includes(t.tradeStatus)) throw new Error("Lock this ownership trade before confirming stock");
    const sides = ownershipSides(t.direction, t.tradeParams);
    if (internalEntity(t.tradeParams)) throw new Error("Internal Pakistan → FZCO sales move through the triparty gate-out, not ownership confirmation");
    if (!(tradeEntity(t.tradeParams) === "FZCO" && t.direction === "BUY")) throw new Error("External sales require a truck release");
    await lockSesameOwnership(db, t.commodity.code);
    if(input.requestKey && await db.sesameOwnershipEntry.findUnique({where:{requestKey:input.requestKey}})) throw new Error("Ownership confirmation already recorded");
    if(!internalEntity(t.tradeParams)&&await db.sesameExportShipment.count({where:{tradeRef:t.tradeRef,directThirdParty:true}}))throw new Error("This purchase is fulfilled through FZCO Truck Movement");
    const confirmed = await db.sesameOwnershipEntry.aggregate({ where: { tradeRef: t.tradeRef, truckId: null }, _sum: { quantityMt: true } });
    if (input.quantityMt <= 0 || n(confirmed._sum.quantityMt) + input.quantityMt > n(t.quantity) + 0.000001) throw new Error("Quantity exceeds the unconfirmed trade quantity");
    const custody = await fzcoCustody(db, t.commodity.code);
    const reserved = await reservedFzco(db, t.commodity.code);
    let warehouseName: string | null = input.warehouseName?.trim() || null;
    if (sides.fromEntity === "PAK") {
      if (!warehouseName) throw new Error("Select the Pakistan warehouse holding this stock");
      await assertGradeAvailable(db,t.commodity.code,warehouseName,sesameGrade(t.tradeParams),input.quantityMt);
      if (await pakistanAvailable(db, t.commodity.code, warehouseName) + 0.000001 < input.quantityMt) throw new Error("Insufficient unreserved Pakistan-owned stock at this warehouse");
    } else if (sides.fromEntity === "FZCO") {
      if (!warehouseName) throw new Error("Pakistan execution must identify the existing custody warehouse for an internal return");
      await assertCustody(db,t.commodity.code,sesameGrade(t.tradeParams),input.quantityMt,{warehouseName});
      if ((custody.get(warehouseName) ?? 0) - (reserved.get(warehouseName) ?? 0) + 0.000001 < input.quantityMt) throw new Error("Insufficient unreserved FZCO ownership at this warehouse");
    } else {
      // External FZCO purchases are paper inventory; never manufacture a warehouse receipt.
      if(input.entity!=="FZCO" || !input.holderId || !input.documentRef?.trim() || !input.ownershipDate)throw new Error("Enter the stock holder, ownership date and supporting document");
      await db.counterparty.findUniqueOrThrow({where:{id:input.holderId}});
      warehouseName = null;
    }
    const entry = await db.sesameOwnershipEntry.create({ data: { tradeRef: t.tradeRef, commodityCode: t.commodity.code, ...sides, quantityMt: input.quantityMt, warehouseName, recordedBy: input.actor, requestKey:input.requestKey, holderId:warehouseName?null:input.holderId,holderLocation:warehouseName?null:input.holderLocation?.trim(),documentRef:input.documentRef,ownershipDate:input.ownershipDate } });
    if (!internalEntity(t.tradeParams)) {
      // Confirmed third-party stock creates the purchase invoice once.
      // Supplier vouchers settle it independently of onward shipments.
      await db.counterpartyLedgerEntry.create({ data: {
        counterpartyId: t.counterpartyId, side: "BUY", entryType: "DEBIT",
        amountPkr: Math.round(input.quantityMt * 1000 * n(contract.ratePerKg) * 100) / 100,
        sourceType: "INVOICE", sourceRef: `OWN-${entry.id}`, tradeRef: t.tradeRef,
        executionEntity:"FZCO", paymentFxRate:Number((t.tradeParams as Record<string,unknown>)?.executionFxPkrPerUsd)||null, note: `FZCO ownership purchase: ${input.quantityMt} MT; confirmed by ${input.actor}`,
      } });
    }
  });
  await refreshContract(input.tradeRef);
}

export async function sesameBook(code: string) {
  const [trades, entries, custody, physical, reserved, gradeRows] = await Promise.all([
    prisma.trade.findMany({ where: { commodity: { code } }, include: { contract: { include: { warehouseAllocations: true } }, counterparty: { select: { name: true } } }, orderBy: { tradeDate: "desc" } }),
    prisma.sesameOwnershipEntry.findMany({ where: { commodityCode: code }, orderBy: { createdAt: "desc" } }),
    fzcoCustody(prisma, code), physicalStock(prisma, code), reservedFzco(prisma, code), sesameGrades(prisma,code),
  ]);
  const confirmed = new Map<string, number>();
  for (const e of entries) if (!e.truckId) confirmed.set(e.tradeRef, (confirmed.get(e.tradeRef) ?? 0) + n(e.quantityMt));
  const rows = trades.filter(t => !["CANCELLED", "REJECTED"].includes(t.tradeStatus)).map(t => {
    const openMt = n(t.contract?.openQtyMt ?? t.quantity);
    const quantityMt = n(t.quantity);
    const counterpart = internalEntity(t.tradeParams);
    const closeOnPayment = t.contract?.closeOnPayment === true;
    const contractStatus = t.contract?.contractStatus ?? null;
    const receivedMt = n(t.contract?.receivedQtyMt);
    return {
    tradeScope: t.tradeScope, sesameType: sesameGrade(t.tradeParams), tradeRef: t.tradeRef, entity: tradeEntity(t.tradeParams), internalEntity: counterpart, direction: t.direction,
    quantityMt, confirmedMt: confirmed.get(t.tradeRef) ?? 0, openMt, receivedMt, closeOnPayment, contractStatus,
    counterparty: t.counterparty.name, status: t.tradeStatus, submitted: t.submittedToExecution, price: n(t.pricePerCanonicalQty ?? t.price), currency: t.currency,
    confirmedValue: (confirmed.get(t.tradeRef) ?? 0) * n(t.pricePerCanonicalQty ?? t.price),
  };});
  const impurities = gradeRows.reduce((s,r)=>s+r.grades.Impurities,0);
  const impurityRefs = new Set(trades.filter(t=>sesameGrade(t.tradeParams)==="Impurities").map(t=>t.tradeRef));
  const impurityEntries = entries.filter(e=>impurityRefs.has(e.tradeRef));
  const fzcoImpurities = impurityEntries.reduce((s,e)=>s+(e.toEntity==="FZCO"?n(e.quantityMt):0)-(e.fromEntity==="FZCO"?n(e.quantityMt):0),0);
  const heldImpurities = impurityEntries.filter(e=>e.warehouseName).reduce((s,e)=>s+(e.toEntity==="FZCO"?n(e.quantityMt):0)-(e.fromEntity==="FZCO"?n(e.quantityMt):0),0);
  const ownedFzco = [...custody.values()].reduce((a,b) => a+b, 0)-fzcoImpurities;
  const physicalPak = [...physical.values()].reduce((a,b) => a+b, 0);
  const heldForFzco = [...custody].filter(([wh]) => wh).reduce((a,[,qty]) => a+qty, 0);
  const market = (await getSeasonNetPositions()).find(p => p.commodityCode === code);
  const contracts = new Map(trades.map(t => [t.tradeRef, t.contract]));
  const acquisitions = entries.filter(e => e.toEntity === "FZCO");
  const purchased = acquisitions.reduce((s,e) => s+n(e.quantityMt),0);
  const fzcoEntry = purchased > 0 ? acquisitions.reduce((s,e) => s+n(e.quantityMt)*n(contracts.get(e.tradeRef)?.ratePerMaund),0)/purchased : null;
  const positions = (["PAK", "FZCO"] as const).map(entity => {
    const own = rows.filter(t => t.sesameType !== "Impurities" && (t.entity === entity || t.internalEntity === entity));
    const open = own.filter(t => ["PENDING", "LOCKED", "CONFIRMED", "EXECUTED"].includes(t.status) && t.submitted);
    const side = (t: typeof rows[number]) => t.entity === entity ? t.direction : t.direction === "BUY" ? "SELL" : "BUY";
    const qty = (t: typeof rows[number]) => sesameBookQty({ quantityMt: t.quantityMt, openMt: t.openMt, receivedMt: t.receivedMt, internal: t.internalEntity != null, closeOnPayment: t.closeOnPayment, contractStatus: t.contractStatus, asEntity: entity });
    const buys = open.filter(t => side(t) === "BUY").reduce((sum,t) => sum+qty(t), 0);
    const sells = open.filter(t => side(t) === "SELL").reduce((sum,t) => sum+qty(t), 0);
    const physicalSells = open.filter(t => side(t) === "SELL").reduce((sum,t) => sum+t.openMt, 0);
    const owned = entity === "FZCO" ? ownedFzco : physicalPak-heldForFzco-impurities+heldImpurities;
    const fzcoBuys = open.filter(t => side(t) === "BUY");
    const fzcoBuyQty = fzcoBuys.reduce((s,t) => s+qty(t), 0);
    const fzcoBuyValue = fzcoBuys.reduce((s,t) => s+qty(t)*n(contracts.get(t.tradeRef)?.ratePerMaund), 0);
    const entryRate = entity === "FZCO" ? (fzcoBuyQty > 0 ? fzcoBuyValue/fzcoBuyQty : fzcoEntry) : market?.tradeEntryRatePkrPerMaund ?? null;
    const marketRate = market?.marketRatePkrPerMaund ?? null;
    const inOut = entryRate != null && marketRate != null ? marketRate-entryRate : null;
    const netQty = entity === "FZCO" ? buys-sells : owned+buys-sells;
    const valuePkr = inOut != null ? inOut*netQty*25 : null;
    return { entity, ownedMt: owned, openBuyMt: buys, openSellMt: sells, bookedNotLeftMt: entity === "PAK" ? physicalSells : sells, freeMt: owned-(entity === "PAK" ? physicalSells : sells), netPositionMt: entity === "FZCO" ? buys-sells : owned+buys-sells, physicalInPakistanMt: entity === "PAK" ? physicalPak-impurities : heldForFzco-heldImpurities, loadingMt: entity === "FZCO" ? [...reserved.values()].reduce((a,b)=>a+b,0) : 0, entryRatePkrPerMaund: entryRate, marketRatePkrPerMaund: marketRate, inOutPkrPerMaund: inOut, inOutValuePkr: valuePkr, inOutValueUsd: valuePkr != null && market?.fxRate ? valuePkr/market.fxRate : null };
  });
  const openSales = trades.filter((t) => ["PENDING", "LOCKED", "CONFIRMED", "EXECUTED"].includes(t.tradeStatus) && !t.directSettled);
  const unassignedBookedMt = openSales.reduce((s, t) => s + unassignedPakistanSaleMt(t), 0);
  const warehouses = await Promise.all([...physical].map(async ([name, quantityMt]) => {
    const fzcoOwnedMt = custody.get(name) ?? 0;
    const pakistanOwnedMt = quantityMt - fzcoOwnedMt;
    const bookedMt = openSales.reduce((s, t) => s + bookedPakistanSaleKgAtWarehouse(t, name) / 1000, 0);
    const processingReservedMt = await processingReservedKg(prisma, code, name) / 1000;
    return { name, quantityMt, fzcoOwnedMt, pakistanOwnedMt, bookedMt, processingReservedMt, freeToSellMt: Math.max(0, pakistanOwnedMt - bookedMt - processingReservedMt) };
  }));
  return { custody:await custodyRows(prisma,code), trades: rows, positions, warehouses, unassignedBookedMt, entries: entries.map(e => ({ ...e, quantityMt: n(e.quantityMt) })) };
}

/** FZCO trucks reserve existing ownership and use the existing DO/finance/gate workflow. */
export async function loadFzcoTruck(input: { tradeRef: string; truckNo: string; weightKg: number; transporterName: string; actor: string }) {
  const result = await prisma.$transaction(async db => {
    const t = await db.trade.findUniqueOrThrow({ where: { tradeRef: input.tradeRef }, include: { commodity: true, counterparty: true, contract: true } });
    const c = t.contract;
    if (!c || !isSesameCommodity(t.commodity.code) || t.tradeStatus !== "LOCKED" || tradeEntity(t.tradeParams) !== "FZCO" || internalEntity(t.tradeParams) || t.direction !== "SELL") throw new Error("Choose a locked external FZCO sale");
    if(t.tradeScope==='INTERNATIONAL')throw new Error('Use the warehouse gatepass link to add international Sesame containers as a shipment group');
    await lockSesameOwnership(db, t.commodity.code);
    const allocated = await db.outboundDispatch.aggregate({ where: { tradeRef: t.tradeRef }, _sum: { allocatedQtyMt: true } });
    const qty = input.weightKg / 1000;
    if (qty <= 0 || n(allocated._sum.allocatedQtyMt)+qty > n(t.quantity)+0.000001) throw new Error("Truck exceeds the remaining sale quantity");
    const custody = await fzcoCustody(db, t.commodity.code), reserved = await reservedFzco(db, t.commodity.code);
    const grade=sesameGrade(t.tradeParams);
    const graded=await custodyRows(db,t.commodity.code);
    const available = [...custody].filter(([wh])=>!!wh).map(([warehouseName,total]) => ({ warehouseName, available: Math.min(total-(reserved.get(warehouseName)??0),graded.find(r=>r.warehouseName===warehouseName&&r.grade===grade)?.availableMt??0) })).sort((a,b) => a.warehouseName.localeCompare(b.warehouseName));
    if (available.reduce((s,a)=>s+Math.max(0,a.available),0)+0.000001 < qty) throw new Error("FZCO does not own enough unreserved stock");
    const amount = Math.round(input.weightKg*n(c.ratePerKg)*100)/100;
    // UUID-based document source; the existing workflow issues sequential DO/gate-out documents.
    const gatepassNo = `FZCO-${crypto.randomUUID()}`;
    const truck = await db.pendingTruck.create({ data: { executionEntity: "FZCO", arrivalDate: new Date(), gatepassNo, counterpartyName: t.counterparty.name, movementType: "OUTBOUND", warehouseName: "", truckNo: input.truckNo.trim().toUpperCase(), transporterName: input.transporterName, builtyDetails: "FZCO export", commodityCode: t.commodity.code, commodityName: t.commodity.name, recordedByName: input.actor, weightKg: input.weightKg, weightAsPerBuiltyKg: input.weightKg, remainingKg: 0, status: "ASSIGNED", assignedTradeRef: t.tradeRef, assignedAt: new Date(), saleBasePkr: amount, saleTaxPkr: 0, saleExpectedPkr: amount, saleStage: "AWAITING_BALANCE" } });
    let remaining = qty;
    for (const bucket of available) {
      const take = Math.min(remaining, Math.max(0,bucket.available));
      if (take <= 0) continue;
      await db.outboundDispatch.create({ data: { gatepassNo, tradeRef: t.tradeRef, dispatchDate: new Date(), liftedBy: input.transporterName, buyerName: t.counterparty.name, warehouseName: bucket.warehouseName, truckNo: truck.truckNo, dispatchWeightKg: take*1000, invoiceWeightKg: take*1000, fungusPct: 0, doRef: gatepassNo, allocatedQtyMt: take, amountDue: take*1000*n(c.ratePerKg), status: "AT_GATE" } });
      remaining -= take;
    }
    await postTruckLedgerDebit({ side: "SELL", truckId: truck.id, gatepassNo, tradeRef: t.tradeRef, counterpartyId: t.counterpartyId, amountPkr: amount, dueDate: null, note: `FZCO outbound ${truck.truckNo}` }, db);
    return truck.id;
  });
  return { truckId: result };
}

export async function releaseFzcoOwnership(db: DB, truckId: string, actor: string) {
  const truck = await db.pendingTruck.findUniqueOrThrow({ where: { id: truckId } });
  await lockSesameOwnership(db, truck.commodityCode!);
  if (truck.saleReleasedAt || await db.sesameOwnershipEntry.count({ where: { truckId } })) throw new Error("This truck was already released");
  const dispatches = await db.outboundDispatch.findMany({ where: { gatepassNo: truck.gatepassNo } });
  const custody = await fzcoCustody(db, truck.commodityCode!);
  const physical = await physicalStock(db, truck.commodityCode!);
  for (const d of dispatches) {
    const trade=await db.trade.findUniqueOrThrow({where:{tradeRef:d.tradeRef}});
    if(!d.warehouseName)throw new Error("Use third-party movements for off-site stock");
    await assertCustody(db,truck.commodityCode!,sesameGrade(trade.tradeParams),n(d.allocatedQtyMt),{warehouseName:d.warehouseName},true);
    if ((custody.get(d.warehouseName) ?? 0)+0.000001 < n(d.allocatedQtyMt)) throw new Error("FZCO ownership no longer covers this load");
    if (d.warehouseName && (physical.get(d.warehouseName) ?? 0)+0.000001 < n(d.allocatedQtyMt)) throw new Error("Physical stock no longer covers this load");
    await db.sesameOwnershipEntry.create({ data: { commodityCode: truck.commodityCode!, tradeRef: d.tradeRef, fromEntity: "FZCO", toEntity: null, quantityMt: d.allocatedQtyMt, warehouseName: d.warehouseName || null, truckId, recordedBy: actor } });
    custody.set(d.warehouseName,(custody.get(d.warehouseName) ?? 0)-n(d.allocatedQtyMt));
  }
}

export async function cancelFzcoLoad(truckId: string) {
  return prisma.$transaction(async db => {
    const truck = await db.pendingTruck.findUniqueOrThrow({ where: { id: truckId } });
    if (truck.executionEntity !== "FZCO" || !truck.commodityCode) throw new Error("Not an FZCO load");
    await lockSesameOwnership(db, truck.commodityCode);
    await db.$queryRaw`SELECT "id" FROM "PendingTruck" WHERE "id" = ${truckId} FOR UPDATE`;
    const current = await db.pendingTruck.findUniqueOrThrow({ where: { id: truckId } });
    if (current.saleReleasedAt || current.saleStage !== "AWAITING_BALANCE" || current.deliveryOrderNo) throw new Error("Only a load awaiting funding, before delivery-order approval, can be cancelled");
    await db.counterpartyLedgerEntry.deleteMany({ where: { truckId } });
    await db.outboundDispatch.deleteMany({ where: { gatepassNo: truck.gatepassNo, status: "AT_GATE" } });
    await db.pendingTruck.delete({ where: { id: truckId } });
    return { ok: true };
  });
}
