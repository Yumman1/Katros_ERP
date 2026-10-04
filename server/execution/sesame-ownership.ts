import { sesameGrades, assertGradeAvailable } from "./sesame-processing";
import { sesameGrade } from "@/lib/sesame-processing";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { tradeEntity, internalEntity, ownershipSides, type SesameEntity } from "@/lib/sesame-entity";
import { isSesameCommodity } from "@/lib/sesame";
import { refreshContract } from "./contracts";
import { postTruckLedgerDebit } from "@/server/finance/ledger";
import { getSeasonNetPositions } from "@/server/net-position";

type DB = Prisma.TransactionClient;
const n = (v: unknown) => Number(v ?? 0);
import { lockSesameOwnership, fzcoCustody, reservedFzco, physicalStock, pakistanAvailable } from "./sesame-stock";

export async function confirmOwnership(input: { tradeRef: string; quantityMt: number; warehouseName?: string; entity: SesameEntity; actor: string }) {
  await prisma.$transaction(async db => {
    const t = await db.trade.findUniqueOrThrow({ where: { tradeRef: input.tradeRef }, include: { commodity: true, contract: true } });
    const contract = t.contract;
    if (!isSesameCommodity(t.commodity.code) || !contract?.paperOwnership || t.tradeStatus !== "LOCKED") throw new Error("Lock this ownership trade before confirming stock");
    const sides = ownershipSides(t.direction, t.tradeParams);
    if (!internalEntity(t.tradeParams) && !(tradeEntity(t.tradeParams) === "FZCO" && t.direction === "BUY")) throw new Error("External sales require a truck release");
    if (internalEntity(t.tradeParams) && input.entity !== "PAK") throw new Error("Pakistan execution must confirm the stock held in custody");
    await lockSesameOwnership(db, t.commodity.code);
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
      if ((custody.get(warehouseName) ?? 0) - (reserved.get(warehouseName) ?? 0) + 0.000001 < input.quantityMt) throw new Error("Insufficient unreserved FZCO ownership at this warehouse");
    } else {
      // External FZCO purchases are paper inventory; never manufacture a warehouse receipt.
      warehouseName = null;
    }
    const entry = await db.sesameOwnershipEntry.create({ data: { tradeRef: t.tradeRef, commodityCode: t.commodity.code, ...sides, quantityMt: input.quantityMt, warehouseName, recordedBy: input.actor } });
    if (!internalEntity(t.tradeParams)) {
      // A paper purchase has no gate invoice. Its payable is an open ownership
      // note, settled by the existing finance-approved note-voucher workflow.
      await db.counterpartyLedgerEntry.create({ data: {
        counterpartyId: t.counterpartyId, side: "BUY", entryType: "DEBIT",
        amountPkr: Math.round(input.quantityMt * 1000 * n(contract.ratePerKg) * 100) / 100,
        sourceType: "ADJUSTMENT", sourceRef: `OWN-${entry.id}`, tradeRef: t.tradeRef,
        noteStatus: "UNPAID", note: `FZCO ownership purchase: ${input.quantityMt} MT; confirmed by ${input.actor}`,
      } });
    }
  });
  await refreshContract(input.tradeRef);
}

export async function sesameBook(code: string) {
  const [trades, entries, custody, physical, reserved, gradeRows] = await Promise.all([
    prisma.trade.findMany({ where: { commodity: { code } }, include: { contract: true, counterparty: { select: { name: true } } }, orderBy: { tradeDate: "desc" } }),
    prisma.sesameOwnershipEntry.findMany({ where: { commodityCode: code }, orderBy: { createdAt: "desc" } }),
    fzcoCustody(prisma, code), physicalStock(prisma, code), reservedFzco(prisma, code), sesameGrades(prisma,code),
  ]);
  const confirmed = new Map<string, number>();
  for (const e of entries) if (!e.truckId) confirmed.set(e.tradeRef, (confirmed.get(e.tradeRef) ?? 0) + n(e.quantityMt));
  const rows = trades.filter(t => !["CANCELLED", "REJECTED"].includes(t.tradeStatus)).map(t => ({
    sesameType: sesameGrade(t.tradeParams), tradeRef: t.tradeRef, entity: tradeEntity(t.tradeParams), internalEntity: internalEntity(t.tradeParams), direction: t.direction,
    quantityMt: n(t.quantity), confirmedMt: confirmed.get(t.tradeRef) ?? 0, openMt: n(t.contract?.openQtyMt ?? t.quantity),
    counterparty: t.counterparty.name, status: t.tradeStatus, submitted: t.submittedToExecution, price: n(t.pricePerCanonicalQty ?? t.price), currency: t.currency,
    confirmedValue: (confirmed.get(t.tradeRef) ?? 0) * n(t.pricePerCanonicalQty ?? t.price),
  }));
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
    const open = own.filter(t => ["PENDING", "LOCKED"].includes(t.status) && t.submitted);
    const side = (t: typeof rows[number]) => t.entity === entity ? t.direction : t.direction === "BUY" ? "SELL" : "BUY";
    const buys = open.filter(t => side(t) === "BUY").reduce((sum,t) => sum+t.openMt, 0);
    const sells = open.filter(t => side(t) === "SELL").reduce((sum,t) => sum+t.openMt, 0);
    const owned = entity === "FZCO" ? ownedFzco : physicalPak-heldForFzco-impurities+heldImpurities;
    const entryRate = entity === "FZCO" ? fzcoEntry : market?.tradeEntryRatePkrPerMaund ?? null;
    const marketRate = market?.marketRatePkrPerMaund ?? null;
    const inOut = entryRate != null && marketRate != null ? marketRate-entryRate : null;
    const valuePkr = inOut != null ? inOut*(owned+buys-sells)*25 : null;
    return { entity, ownedMt: owned, openBuyMt: buys, bookedNotLeftMt: sells, freeMt: owned-sells, netPositionMt: owned+buys-sells, physicalInPakistanMt: entity === "PAK" ? physicalPak-impurities : heldForFzco-heldImpurities, loadingMt: entity === "FZCO" ? [...reserved.values()].reduce((a,b)=>a+b,0) : 0, entryRatePkrPerMaund: entryRate, marketRatePkrPerMaund: marketRate, inOutPkrPerMaund: inOut, inOutValuePkr: valuePkr, inOutValueUsd: valuePkr != null && market?.fxRate ? valuePkr/market.fxRate : null };
  });
  return { trades: rows, positions, warehouses: [...physical].map(([name, quantityMt]) => ({ name, quantityMt, fzcoOwnedMt: custody.get(name) ?? 0, pakistanOwnedMt: quantityMt-(custody.get(name) ?? 0) })), entries: entries.map(e => ({ ...e, quantityMt: n(e.quantityMt) })) };
}

/** FZCO trucks reserve existing ownership and use the existing DO/finance/gate workflow. */
export async function loadFzcoTruck(input: { tradeRef: string; truckNo: string; weightKg: number; transporterName: string; actor: string }) {
  const result = await prisma.$transaction(async db => {
    const t = await db.trade.findUniqueOrThrow({ where: { tradeRef: input.tradeRef }, include: { commodity: true, counterparty: true, contract: true } });
    const c = t.contract;
    if (!c || !isSesameCommodity(t.commodity.code) || t.tradeStatus !== "LOCKED" || tradeEntity(t.tradeParams) !== "FZCO" || internalEntity(t.tradeParams) || t.direction !== "SELL") throw new Error("Choose a locked external FZCO sale");
    await lockSesameOwnership(db, t.commodity.code);
    const allocated = await db.outboundDispatch.aggregate({ where: { tradeRef: t.tradeRef }, _sum: { allocatedQtyMt: true } });
    const qty = input.weightKg / 1000;
    if (qty <= 0 || n(allocated._sum.allocatedQtyMt)+qty > n(t.quantity)+0.000001) throw new Error("Truck exceeds the remaining sale quantity");
    const custody = await fzcoCustody(db, t.commodity.code), reserved = await reservedFzco(db, t.commodity.code);
    const available = [...custody].map(([warehouseName,total]) => ({ warehouseName, available: total-(reserved.get(warehouseName)??0) })).sort((a,b) => a.warehouseName.localeCompare(b.warehouseName));
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
