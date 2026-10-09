import type { VoucherView } from "@/server/finance/vouchers";
import { downloadPurchaseDocument } from "./purchase-document-pdf";
export async function downloadPurchaseVoucher(v:VoucherView){
  const money=(n:number|null)=>n==null?"Not recorded":`${n.toLocaleString("en-PK")} PKR`;
  const state=v.status==="APPROVED"?"COMPLETED":v.status==="REJECTED"?"REJECTED":v.traderApprovalRequired&&!v.traderApprovedAt?"PENDING-TRADER":"PENDING-FINANCE";
  return downloadPurchaseDocument("PURCHASE PAYMENT VOUCHER",v.voucherNo,v.voucherDate,[
    ["Status",state],["Commodity",v.commodityCode??"-"],["Supplier",v.counterpartyName],["Trade reference",v.tradeRef??"-"],
    ["Purchase basis",v.purchaseProfile==="PURCHASE_SPOT"?"Spot":v.purchaseProfile==="PURCHASE_DELIVERED"?"Delivered":"Purchase settlement"],
    ["Agreed trade amount",money(v.agreedTradeAmountPkr)],["Agreed advance",v.agreedAdvancePercentage==null?"Not recorded":`${v.agreedAdvancePercentage}%`],
    ["Truck / Builty",`${v.truckNo??"-"} / ${v.builtyNumber??"-"}`],["Transporter",v.transporterName??"-"],["Advance weight",`${v.advanceWeightKg?.toLocaleString()??"-"} kg`],
    ["Requested advance",`${v.advancePercentage??0}%`],["Calculated amount",money(v.calculatedAdvancePkr)],["Requested payment",money(v.amountPkr)],
    ["Payment method",v.method??"Pending Finance"],["Bank",v.bankName??"-"],["Payment slip reference",v.reference??"Pending payment"],
    ["Prepared by",v.enteredByName],["Excess advance approval",v.traderApprovedBy??(v.traderApprovalRequired?"Pending trader":"Not required")],["Finance approval",v.resolvedByName??"Pending"],
  ],`${v.voucherNo}-${state}-purchase-voucher.pdf`);
}
