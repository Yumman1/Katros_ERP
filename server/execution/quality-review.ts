import { isSesameCommodity } from "@/lib/sesame";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { tradeEntity } from "@/lib/sesame-entity";
import { contractMatchesWarehouse } from "@/lib/warehouse-allocation";
import { CONTRACT_INCLUDE, contractRowToRuntime } from "./runtime";

export async function recordTruckQuality(input: {truckId:string;tradeRef:string;readings:Record<string,string>;deductionKg:number}, actor:string, commodityCode?:string, entity="PAK") {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "PendingTruck" WHERE id=${input.truckId} FOR UPDATE`;
    const truck = await tx.pendingTruck.findUniqueOrThrow({where:{id:input.truckId}});
    const contract = await tx.executionContract.findUniqueOrThrow({where:{tradeRef:input.tradeRef},include:CONTRACT_INCLUDE});
    const trade = await tx.trade.findUniqueOrThrow({where:{tradeRef:input.tradeRef},include:{commodity:true,counterparty:true}});
    if (truck.executionEntity !== entity || (commodityCode && truck.commodityCode !== commodityCode) || tradeEntity(trade.tradeParams) !== entity) throw new Error("Truck belongs to another desk");
    if (truck.movementType !== "INBOUND" || truck.status !== "PENDING" || truck.gateInvoiceNo) throw new Error("Quality must be reviewed before assignment and invoicing");
    if (trade.direction !== "BUY" || trade.commodity.code !== truck.commodityCode || trade.counterparty.name !== truck.counterpartyName) throw new Error("Select this truck's purchase trade");
    if (contract.executionProfile !== "PURCHASE_SPOT" && !contractMatchesWarehouse(contractRowToRuntime(contract),truck.warehouseName)) throw new Error("Trade is not allocated to this warehouse");
    const advance = await tx.voucher.findUnique({where:{advanceTruckId:truck.id}});
    if (advance && advance.tradeRef !== input.tradeRef) throw new Error("Use the trade linked to this truck's advance");
    if (contract.contractStatus !== "Open" || !["LOCKED","CONFIRMED"].includes(trade.tradeStatus)) throw new Error("Select an open locked purchase trade");
    const spot = contract.executionProfile === "PURCHASE_SPOT";
    if (spot && input.deductionKg !== 0) throw new Error("Spot purchases cannot have weight deductions");
    const base = Number(spot ? truck.weightAsPerBuiltyKg : truck.warehouseWeightKg);
    if (!(base > 0) || !Number.isFinite(input.deductionKg) || input.deductionKg < 0 || input.deductionKg >= base) throw new Error("Enter the received weight and a deduction below that weight");
    const keys = isSesameCommodity(truck.commodityCode) ? ["purity","ffa","moisture","oilContent","admixture"] : ["moisturePct","damagePct","brokenPct","fungusPct","foreignMatterPct"];
    for (const key of keys) if (!input.readings[key]?.trim() || !Number.isFinite(Number(input.readings[key])) || Number(input.readings[key]) < 0 || Number(input.readings[key]) > 100) throw new Error(`Enter ${key} between 0 and 100%`);
    const specs = {damagePct:Number(input.readings.damagePct)||0,brokenPct:Number(input.readings.brokenPct)||0,fungusPct:Number(input.readings.fungusPct)||0,foreignMatterPct:Number(input.readings.foreignMatterPct)||0,moisturePct:Number(input.readings.moisturePct ?? input.readings.moisture)||0};
    return tx.pendingTruck.update({where:{id:truck.id},data:{qualityTradeRef:input.tradeRef,qualityReviewedAt:new Date(),qualityReviewedBy:actor,labReadings:input.readings as Prisma.InputJsonValue,qualitySpecs:specs,totalDeductionsKg:input.deductionKg,weightKg:base-input.deductionKg,remainingKg:base-input.deductionKg}});
  });
}
