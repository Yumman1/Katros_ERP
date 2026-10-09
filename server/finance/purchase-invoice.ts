import { prisma } from "@/server/db";
import { purchaseAdvancePercentage } from "@/lib/purchase-advance";
export async function purchaseInvoiceDocument(requestRef:string){
 const p=await prisma.paymentRequest.findUniqueOrThrow({where:{requestRef},include:{trade:{include:{commodity:true}}}});
 if(p.sourceType!=="INBOUND")throw new Error("This request is not a purchase invoice");
 const r=await prisma.inboundReceipt.findUniqueOrThrow({where:{id:p.sourceId}});
 const t=r.gatepassNo?await prisma.pendingTruck.findUnique({where:{gatepassNo:r.gatepassNo}}):null;
 const c=await prisma.executionContract.findUniqueOrThrow({where:{tradeRef:p.tradeRef}});
 const advance=purchaseAdvancePercentage(p.trade.paymentType,p.trade.tradeParams);
 return {requestRef:p.requestRef,invoiceNo:p.invoiceNumber??t?.gateInvoiceNo??r.billNo??p.requestRef,date:p.createdAt,status:p.status,reference:p.paymentReference,approvedBy:p.approvedBy,tradeRef:p.tradeRef,commodity:p.trade.commodity.name,counterparty:p.counterpartyName,truckNo:r.truckNo,builty:r.biltyNo,basis:c.executionProfile==="PURCHASE_SPOT"?"Spot":"Delivered",physicalKg:Number(r.weightWarehouseKg),sellerKg:Number(r.weightSpotKg),deductionKg:Number(t?.totalDeductionsKg??r.weightDiffKg),payableKg:Number(t?.gateInvoiceWeightKg??0),rateKg:Number(t?.gateInvoiceRatePerKg??c.ratePerKg??0),total:Number(r.amountDue),paid:Number(r.paidAmountPkr),paymentAmount:Number(p.amount),remainingPercentage:Number(p.remainingPercentage??100-advance),agreedAdvancePercentage:advance,quality:t?.labReadings as Record<string,string>|null};
}
