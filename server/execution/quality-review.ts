import { postTruckLedgerDebit } from "@/server/finance/ledger";
import { kgToQuantityUnit } from "@/lib/unit-conversion";
import { KG_PER_MAUND } from "@/lib/trade-constants";
import { usesSesameWorkflow } from "@/lib/sesame";
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
    const keys = usesSesameWorkflow(truck.commodityCode) ? ["purity","ffa","moisture","oilContent","admixture"] : ["moisturePct","damagePct","brokenPct","fungusPct","foreignMatterPct"];
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

/** Trader changes the financial deduction before releasing the invoice to Finance. */
export async function amendInvoiceDeduction(input:{truckId:string;deductionKg:number;expectedDeductionKg:number;expectedAmountPkr:number},actor:string){
 const {traderNamesMatch}=await import('@/lib/trader-identity');
 return prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "PendingTruck" WHERE id=${input.truckId} FOR UPDATE`;
  const truck=await tx.pendingTruck.findUniqueOrThrow({where:{id:input.truckId}});
  const ref=truck.assignedTradeRef??truck.gateInvoiceTradeRef;
  if(!ref)throw new Error('Invoice has no trade');
  const trade=await tx.trade.findUniqueOrThrow({where:{tradeRef:ref},include:{contract:true}});
  if(!traderNamesMatch(trade.traderName,actor))throw new Error('This invoice is not linked to one of your trades');
  if(!truck.qualityReviewedAt||!truck.gateInvoiceNo||!['PENDING_TRADE_APPROVAL','HOLD_OLD_DUES'].includes(truck.gateInvoiceStage??'')||!trade.contract)throw new Error('Deductions can only be edited before payment approval');
  if(Math.abs(Number(truck.totalDeductionsKg)-input.expectedDeductionKg)>.000001||Math.abs(Number(truck.gateInvoiceAmount)-input.expectedAmountPkr)>.005)throw new Error('Invoice changed. Refresh before editing');
  const spot=trade.contract.executionProfile==='PURCHASE_SPOT';
  const base=Number(spot?truck.weightAsPerBuiltyKg:truck.warehouseWeightKg);
  if(spot&&input.deductionKg!==0)throw new Error('Ex-Works purchases cannot have deductions');
  if(!Number.isFinite(input.deductionKg)||input.deductionKg<0||input.deductionKg>=base)throw new Error('Deduction must be zero or less than the invoice weight');
  const receipts=await tx.inboundReceipt.findMany({where:{gatepassNo:truck.gatepassNo,tradeRef:ref}});
  if(receipts.length!==1)throw new Error('This invoice needs reconciliation before editing');
  if(await tx.paymentRequest.count({where:{sourceType:'INBOUND',sourceId:receipts[0].id,status:{in:['PENDING','APPROVED']}}}))throw new Error('Resolve the Finance payment before changing deductions');
  const rate=Number(truck.gateInvoiceRatePerKg??trade.contract.ratePerKg),payable=base-input.deductionKg;
  const amount=Math.round(payable*rate*100)/100;
  if(!(rate>0)||amount+.005<Number(receipts[0].paidAmountPkr))throw new Error('Revised invoice cannot be below the amount already applied; reconcile the payment first');
  await tx.inboundReceipt.update({where:{id:receipts[0].id},data:{amountDue:amount,weightDiffKg:input.deductionKg}});
  await tx.counterpartyLedgerEntry.update({where:{truckId:truck.id},data:{amountPkr:amount,note:`Truck ${truck.truckNo} · Builty ${truck.builtyDetails} · Invoice ${truck.gateInvoiceNo} · Deduction changed by ${actor}: ${truck.totalDeductionsKg} → ${input.deductionKg} kg`}});
  await tx.pendingTruck.update({where:{id:truck.id},data:{totalDeductionsKg:input.deductionKg,gateInvoiceAmount:amount,gateInvoiceExpectedPkr:amount,gateInvoiceWeightKg:payable,gateInvoiceQtyMt:kgToQuantityUnit(payable,trade.contract.quantityUnit)}});
  return {amountPkr:amount};
 });
}
