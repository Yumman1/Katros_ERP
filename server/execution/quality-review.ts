import { postTruckLedgerDebit } from "@/server/finance/ledger";
import { kgToQuantityUnit } from "@/lib/unit-conversion";
import { KG_PER_MAUND } from "@/lib/trade-constants";
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
    if (truck.movementType !== "INBOUND" || truck.status !== "ASSIGNED" || truck.assignedTradeRef !== input.tradeRef || truck.gateInvoiceNo) throw new Error("Assign the truck first; an invoice can only be generated once");
    if (trade.direction !== "BUY" || trade.commodity.code !== truck.commodityCode || trade.counterparty.name !== truck.counterpartyName) throw new Error("Select this truck's purchase trade");
    if (contract.executionProfile !== "PURCHASE_SPOT" && !contractMatchesWarehouse(contractRowToRuntime(contract),truck.warehouseName)) throw new Error("Trade is not allocated to this warehouse");
    const advance = await tx.voucher.findUnique({where:{advanceTruckId:truck.id}});
    if (advance && advance.tradeRef !== input.tradeRef) throw new Error("Use the trade linked to this truck's advance");
    if (!["LOCKED","CONFIRMED","EXECUTED","SETTLED"].includes(trade.tradeStatus)) throw new Error("Trade is not eligible for invoicing");
    const spot = contract.executionProfile === "PURCHASE_SPOT";
    if (spot && input.deductionKg !== 0) throw new Error("Spot purchases cannot have weight deductions");
    const base = Number(spot ? truck.weightAsPerBuiltyKg : truck.warehouseWeightKg);
    if (!(base > 0) || !Number.isFinite(input.deductionKg) || input.deductionKg < 0 || input.deductionKg >= base) throw new Error("Enter the received weight and a deduction below that weight");
    const keys = isSesameCommodity(truck.commodityCode) ? ["purity","ffa","moisture","oilContent","admixture"] : ["moisturePct","damagePct","brokenPct","fungusPct","foreignMatterPct"];
    for (const key of keys) if (!input.readings[key]?.trim() || !Number.isFinite(Number(input.readings[key])) || Number(input.readings[key]) < 0 || Number(input.readings[key]) > 100) throw new Error(`Enter ${key} between 0 and 100%`);
    const specs = {damagePct:Number(input.readings.damagePct)||0,brokenPct:Number(input.readings.brokenPct)||0,fungusPct:Number(input.readings.fungusPct)||0,foreignMatterPct:Number(input.readings.foreignMatterPct)||0,moisturePct:Number(input.readings.moisturePct ?? input.readings.moisture)||0};
    const invoiceNo = `INV-${truck.gatepassNo}`;
    const payableKg = base - input.deductionKg;
    const rateKg = Number(contract.ratePerKg ?? Number(contract.ratePerMaund ?? 0) / KG_PER_MAUND);
    const amount = Math.round(payableKg * rateKg * 100) / 100;
    if (!(amount > 0)) throw new Error("The trade must have a positive locked price before invoicing");
    const receipts = await tx.inboundReceipt.findMany({where:{gatepassNo:truck.gatepassNo,tradeRef:input.tradeRef}});
    if (receipts.length !== 1 || Number(receipts[0].paidAmountPkr) > 0) throw new Error("This truck requires reconciliation before invoicing");
    await tx.inboundReceipt.update({where:{id:receipts[0].id},data:{billNo:invoiceNo,amountDue:amount,weightDiffKg:input.deductionKg,...specs}});
    const params = (trade.tradeParams ?? {}) as Record<string,unknown>;
    const days = trade.paymentType === "CREDIT_30" ? 30 : trade.paymentType === "CREDIT" ? Number(params.creditDays) || 0 : 0;
    await postTruckLedgerDebit({side:"BUY",truckId:truck.id,gatepassNo:truck.gatepassNo,tradeRef:input.tradeRef,counterpartyId:trade.counterpartyId,amountPkr:amount,dueDate:days ? new Date(Date.now()+days*86400000) : null,note:`Truck ${truck.truckNo} · Builty ${truck.builtyDetails} · Invoice ${invoiceNo} · Financial deduction ${input.deductionKg} kg`},tx);
    return tx.pendingTruck.update({where:{id:truck.id},data:{qualityTradeRef:input.tradeRef,qualityReviewedAt:new Date(),qualityReviewedBy:actor,labReadings:input.readings as Prisma.InputJsonValue,qualitySpecs:specs,totalDeductionsKg:input.deductionKg,gateInvoiceNo:invoiceNo,gateInvoiceAmount:amount,gateInvoiceExpectedPkr:amount,gateInvoiceWeightKg:payableKg,gateInvoiceQtyMt:kgToQuantityUnit(payableKg,contract.quantityUnit),gateInvoiceRatePerKg:rateKg,gateInvoiceTradeRef:input.tradeRef,gateInvoiceCurrency:contract.currency,gateInvoiceStage:"PENDING_TRADE_APPROVAL"}});
  });
}
