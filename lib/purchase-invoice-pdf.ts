import type { purchaseInvoiceDocument } from "@/server/finance/purchase-invoice";
import { downloadPurchaseDocument } from "./purchase-document-pdf";
export async function downloadPurchaseInvoice(v:Awaited<ReturnType<typeof purchaseInvoiceDocument>>){
 const money=(n:number)=>`${n.toLocaleString("en-PK")} PKR`;const state=v.status==="APPROVED"?"COMPLETED":v.status;
 return downloadPurchaseDocument("PURCHASE INVOICE",v.invoiceNo,v.date,[
 ["Status",state],["Trade / Commodity",`${v.tradeRef} / ${v.commodity}`],["Supplier",v.counterparty],["Purchase basis",v.basis],
 ["Truck / Builty",`${v.truckNo} / ${v.builty}`],["Warehouse weight",`${v.physicalKg.toLocaleString()} kg`],["Seller weight",`${v.sellerKg.toLocaleString()} kg`],
 ["Financial deduction",`${v.deductionKg.toLocaleString()} kg`],["Payable weight",`${v.payableKg.toLocaleString()} kg`],["Locked rate / kg",money(v.rateKg)],
 ["Quality results",v.quality?Object.entries(v.quality).map(([k,x])=>`${k}: ${x}%`).join("; "):"Historical invoice"],
 ["Total amount",money(v.total)],["Agreed advance",`${v.agreedAdvancePercentage}%`],["Remaining payment terms",`${v.remainingPercentage}% (actual balance reconciled below)`],
 ["Paid to date",money(v.paid)],["This payment",money(v.paymentAmount)],["Outstanding balance",money(Math.max(0,v.total-v.paid))],
 ["Payment request",v.requestRef],["Payment slip reference",v.reference??"Pending payment"],["Finance approval",v.approvedBy??"Pending"],
 ],`${v.invoiceNo}-${v.requestRef}-${state}.pdf`);
}
