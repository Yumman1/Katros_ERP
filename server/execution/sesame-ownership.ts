import {custodyRows} from './fzco-custody';
import { sesameGrade } from "@/lib/sesame-processing";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { tradeEntity, internalEntity, sesameBookQty, FZCO_NO_PAKISTAN_WAREHOUSE, FZCO_NO_PAPER_OWNERSHIP, type SesameEntity } from "@/lib/sesame-entity";
import { isSesameCommodity } from "@/lib/sesame";
import { getSeasonNetPositions } from "@/server/net-position";

type DB = Prisma.TransactionClient;
const n = (v: unknown) => Number(v ?? 0);
import { lockSesameOwnership, reservedFzco, physicalStock } from "./sesame-stock";
import { processingReservedKg } from "./processing-reservations";
import { bookedPakistanSaleKgAtWarehouse, unassignedPakistanSaleMt } from "./sesame-sale-reservation";

export async function confirmOwnership(_input: { tradeRef: string; quantityMt: number; warehouseName?: string; entity: SesameEntity; actor: string; holderId?: string; holderLocation?: string; documentRef?: string; ownershipDate?: Date; requestKey?: string }): Promise<never> {
  throw new Error(FZCO_NO_PAPER_OWNERSHIP);
}

export async function sesameBook(code: string) {
  const [trades, entries, physical, reserved] = await Promise.all([
    prisma.trade.findMany({ where: { commodity: { code } }, include: { contract: { include: { warehouseAllocations: true } }, counterparty: { select: { name: true } } }, orderBy: { tradeDate: "desc" } }),
    prisma.sesameOwnershipEntry.findMany({ where: { commodityCode: code }, orderBy: { createdAt: "desc" } }),
    physicalStock(prisma, code), reservedFzco(prisma, code),
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
  const market = (await getSeasonNetPositions()).find(p => p.commodityCode === code);
  const contracts = new Map(trades.map(t => [t.tradeRef, t.contract]));
  const positions = (["PAK", "FZCO"] as const).map(entity => {
    const own = rows.filter(t => t.sesameType !== "Impurities" && (t.entity === entity || t.internalEntity === entity));
    const open = own.filter(t => ["PENDING", "LOCKED", "CONFIRMED", "EXECUTED"].includes(t.status) && t.submitted);
    const side = (t: typeof rows[number]) => t.entity === entity ? t.direction : t.direction === "BUY" ? "SELL" : "BUY";
    const qty = (t: typeof rows[number]) => sesameBookQty({ quantityMt: t.quantityMt, openMt: t.openMt, receivedMt: t.receivedMt, internal: t.internalEntity != null, closeOnPayment: t.closeOnPayment, contractStatus: t.contractStatus, asEntity: entity });
    const buys = open.filter(t => side(t) === "BUY").reduce((sum,t) => sum+qty(t), 0);
    const sells = open.filter(t => side(t) === "SELL").reduce((sum,t) => sum+qty(t), 0);
    const physicalSells = open.filter(t => side(t) === "SELL").reduce((sum,t) => sum+t.openMt, 0);
    const owned = entity === "FZCO" ? 0 : physicalPak;
    const fzcoBuys = open.filter(t => side(t) === "BUY");
    const fzcoBuyQty = fzcoBuys.reduce((s,t) => s+qty(t), 0);
    const fzcoBuyValue = fzcoBuys.reduce((s,t) => s+qty(t)*n(contracts.get(t.tradeRef)?.ratePerMaund), 0);
    const entryRate = entity === "FZCO" ? (fzcoBuyQty > 0 ? fzcoBuyValue/fzcoBuyQty : null) : market?.tradeEntryRatePkrPerMaund ?? null;
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
