import {custodyRows} from './fzco-custody';
import { sesameGrade } from "@/lib/sesame-processing";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { tradeEntity, internalEntity, ownershipSides, sesameBookQty, FZCO_NO_PAKISTAN_WAREHOUSE, type SesameEntity } from "@/lib/sesame-entity";
import { isSesameCommodity } from "@/lib/sesame";
import { refreshContract } from "./contracts";
import { getSeasonNetPositions } from "@/server/net-position";

type DB = Prisma.TransactionClient;
const n = (v: unknown) => Number(v ?? 0);
import { lockSesameOwnership, fzcoCustody, reservedFzco, physicalStock } from "./sesame-stock";
import { processingReservedKg } from "./processing-reservations";
import { bookedPakistanSaleKgAtWarehouse, unassignedPakistanSaleMt } from "./sesame-sale-reservation";

export async function confirmOwnership(input: { tradeRef: string; quantityMt: number; warehouseName?: string; entity: SesameEntity; actor: string; holderId?: string; holderLocation?: string; documentRef?: string; ownershipDate?: Date; requestKey?: string }) {
  await prisma.$transaction(async db => {
    const t = await db.trade.findUniqueOrThrow({ where: { tradeRef: input.tradeRef }, include: { commodity: true, contract: true } });
    const contract = t.contract;
    if (!isSesameCommodity(t.commodity.code) || !contract?.paperOwnership || !["LOCKED","EXECUTED"].includes(t.tradeStatus)) throw new Error("Lock this ownership trade before confirming stock");
    if (internalEntity(t.tradeParams)) throw new Error("Internal Pakistan → FZCO sales move through the triparty gate-out, not ownership confirmation");
    if (!(tradeEntity(t.tradeParams) === "FZCO" && t.direction === "BUY")) throw new Error("External sales require a truck release");
    if (input.warehouseName?.trim()) throw new Error(FZCO_NO_PAKISTAN_WAREHOUSE);
    await lockSesameOwnership(db, t.commodity.code);
    if(input.requestKey && await db.sesameOwnershipEntry.findUnique({where:{requestKey:input.requestKey}})) throw new Error("Ownership confirmation already recorded");
    if(await db.sesameExportShipment.count({where:{tradeRef:t.tradeRef,directThirdParty:true}}))throw new Error("This purchase is fulfilled through FZCO Truck Movement");
    const confirmed = await db.sesameOwnershipEntry.aggregate({ where: { tradeRef: t.tradeRef, truckId: null }, _sum: { quantityMt: true } });
    if (input.quantityMt <= 0 || n(confirmed._sum.quantityMt) + input.quantityMt > n(t.quantity) + 0.000001) throw new Error("Quantity exceeds the unconfirmed trade quantity");
    if(input.entity!=="FZCO" || !input.holderId || !input.documentRef?.trim() || !input.ownershipDate)throw new Error("Enter the stock holder, ownership date and supporting document");
    await db.counterparty.findUniqueOrThrow({where:{id:input.holderId}});
    const sides = ownershipSides(t.direction, t.tradeParams);
    const entry = await db.sesameOwnershipEntry.create({ data: { tradeRef: t.tradeRef, commodityCode: t.commodity.code, ...sides, quantityMt: input.quantityMt, warehouseName: null, recordedBy: input.actor, requestKey:input.requestKey, holderId:input.holderId,holderLocation:input.holderLocation?.trim()||null,documentRef:input.documentRef,ownershipDate:input.ownershipDate } });
    await db.counterpartyLedgerEntry.create({ data: {
      counterpartyId: t.counterpartyId, side: "BUY", entryType: "DEBIT",
      amountPkr: Math.round(input.quantityMt * 1000 * n(contract.ratePerKg) * 100) / 100,
      sourceType: "INVOICE", sourceRef: `OWN-${entry.id}`, tradeRef: t.tradeRef,
      executionEntity:"FZCO", paymentFxRate:Number((t.tradeParams as Record<string,unknown>)?.executionFxPkrPerUsd)||null, note: `FZCO ownership purchase: ${input.quantityMt} MT; confirmed by ${input.actor}`,
    } });
  });
  await refreshContract(input.tradeRef);
}

export async function sesameBook(code: string) {
  const [trades, entries, custody, physical, reserved] = await Promise.all([
    prisma.trade.findMany({ where: { commodity: { code } }, include: { contract: { include: { warehouseAllocations: true } }, counterparty: { select: { name: true } } }, orderBy: { tradeDate: "desc" } }),
    prisma.sesameOwnershipEntry.findMany({ where: { commodityCode: code }, orderBy: { createdAt: "desc" } }),
    fzcoCustody(prisma, code), physicalStock(prisma, code), reservedFzco(prisma, code),
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
  const physicalPak = [...physical.values()].reduce((a,b) => a+b, 0);
  const ownedFzco = [...custody.values()].reduce((a,b) => a+b, 0);
  const market = (await getSeasonNetPositions()).find(p => p.commodityCode === code);
  const contracts = new Map(trades.map(t => [t.tradeRef, t.contract]));
  const acquisitions = entries.filter(e => e.toEntity === "FZCO" && !e.warehouseName);
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
    const owned = entity === "FZCO" ? ownedFzco : physicalPak;
    const fzcoBuys = open.filter(t => side(t) === "BUY");
    const fzcoBuyQty = fzcoBuys.reduce((s,t) => s+qty(t), 0);
    const fzcoBuyValue = fzcoBuys.reduce((s,t) => s+qty(t)*n(contracts.get(t.tradeRef)?.ratePerMaund), 0);
    const entryRate = entity === "FZCO" ? (fzcoBuyQty > 0 ? fzcoBuyValue/fzcoBuyQty : fzcoEntry) : market?.tradeEntryRatePkrPerMaund ?? null;
    const marketRate = market?.marketRatePkrPerMaund ?? null;
    const inOut = entryRate != null && marketRate != null ? marketRate-entryRate : null;
    const netQty = entity === "FZCO" ? buys-sells : owned+buys-sells;
    const valuePkr = inOut != null ? inOut*netQty*25 : null;
    return { entity, ownedMt: owned, openBuyMt: buys, openSellMt: sells, bookedNotLeftMt: entity === "PAK" ? physicalSells : sells, freeMt: owned-(entity === "PAK" ? physicalSells : sells), netPositionMt: entity === "FZCO" ? buys-sells : owned+buys-sells, physicalInPakistanMt: entity === "PAK" ? physicalPak : 0, loadingMt: entity === "FZCO" ? [...reserved.values()].reduce((a,b)=>a+b,0) : 0, entryRatePkrPerMaund: entryRate, marketRatePkrPerMaund: marketRate, inOutPkrPerMaund: inOut, inOutValuePkr: valuePkr, inOutValueUsd: valuePkr != null && market?.fxRate ? valuePkr/market.fxRate : null };
  });
  const openSales = trades.filter((t) => ["PENDING", "LOCKED", "CONFIRMED", "EXECUTED"].includes(t.tradeStatus) && !t.directSettled);
  const unassignedBookedMt = openSales.reduce((s, t) => s + unassignedPakistanSaleMt(t), 0);
  const warehouses = await Promise.all([...physical].map(async ([name, quantityMt]) => {
    const bookedMt = openSales.reduce((s, t) => s + bookedPakistanSaleKgAtWarehouse(t, name) / 1000, 0);
    const processingReservedMt = await processingReservedKg(prisma, code, name) / 1000;
    return { name, quantityMt, bookedMt, processingReservedMt, freeToSellMt: Math.max(0, quantityMt - bookedMt - processingReservedMt) };
  }));
  return { custody:await custodyRows(prisma,code), trades: rows, positions, warehouses, unassignedBookedMt, entries: entries.map(e => ({ ...e, quantityMt: n(e.quantityMt) })) };
}

/** FZCO does not load trucks from Pakistan warehouses. Use triparty or a third-party movement. */
export async function loadFzcoTruck(input: { tradeRef: string; truckNo: string; weightKg: number; transporterName: string; actor: string }) {
  const t = await prisma.trade.findUniqueOrThrow({ where: { tradeRef: input.tradeRef }, include: { commodity: true, contract: true } });
  if (!t.contract || !isSesameCommodity(t.commodity.code) || t.tradeStatus !== "LOCKED" || tradeEntity(t.tradeParams) !== "FZCO" || internalEntity(t.tradeParams) || t.direction !== "SELL") throw new Error("Choose a locked external FZCO sale");
  if (t.tradeScope === "INTERNATIONAL") throw new Error("Use the warehouse gatepass link to add international Sesame containers as a shipment group");
  throw new Error(FZCO_NO_PAKISTAN_WAREHOUSE);
}

export async function releaseFzcoOwnership(db: DB, truckId: string, actor: string) {
  void actor;
  const truck = await db.pendingTruck.findUniqueOrThrow({ where: { id: truckId } });
  if (!truck.commodityCode) return;
  await lockSesameOwnership(db, truck.commodityCode);
  if (truck.saleReleasedAt || await db.sesameOwnershipEntry.count({ where: { truckId } })) throw new Error("This truck was already released");
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
