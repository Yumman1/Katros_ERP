import type { VoucherView } from "@/server/finance/vouchers";
import { downloadPurchaseDocument } from "./purchase-document-pdf";
export async function downloadPurchaseVoucher(v:VoucherView){
  const money=(n:number|null)=>n==null?"Not recorded":`${n.toLocaleString("en-PK")} PKR`;
  const state=v.status==="APPROVED"?"COMPLETED":v.status==="REJECTED"?"REJECTED":v.traderApprovalRequired&&!v.traderApprovedAt?"PENDING-TRADER":"PENDING-FINANCE";
  if(v.voucherKind === 'INTERNAL_TRADE') return downloadPurchaseDocument('INTERNAL TRADE SETTLEMENT',v.voucherNo,v.voucherDate,[
    ['Status',state],['Buyer',v.executionEntity==='PAK'?'Kastros Pakistan':'Dubai FZCO'],['Seller',v.executionEntity==='PAK'?'Dubai FZCO':'Kastros Pakistan'],['Commodity',v.commodityCode??'-'],['Trade reference',v.tradeRef??'-'],
    ['Agreed trade value',money(v.agreedTradeAmountPkr)],['Payment amount',v.amountUsd!=null?`${v.amountUsd.toFixed(2)} USD`:money(v.amountPkr)],
    ['PKR equivalent',money(v.amountPkr)],['Prepared by',v.enteredByName],['Trader approval',v.traderApprovedBy??'Pending'],
    ['Payment method',v.method??'Pending Finance'],['Bank',v.bankName??'-'],['Payment reference',v.reference??'Pending Finance'],['Finance approval',v.resolvedByName??'Pending'],
  ],`${v.voucherNo}-${state}-internal-trade.pdf`);
  if(v.internalPaymentRef)return downloadPurchaseDocument(v.side==='BUY'?'INTERNAL PURCHASE PAYMENT':'INTERNAL SALES RECEIPT',v.voucherNo,v.voucherDate,[['Status',state],['Entity',v.executionEntity],['Counterparty',v.counterpartyName],['Commodity',v.commodityCode??'-'],['Trade',v.tradeRef??'-'],['Reconciliation reference',v.internalPaymentRef],['Amount',v.amountUsd!=null?`${v.amountUsd.toFixed(2)} USD`:money(v.amountPkr)],['Method',v.method??'Pending Finance'],['Bank',v.bankName??'-'],['Payment slip reference',v.reference??'Pending Finance'],['Prepared by',v.enteredByName],['Approved by',v.resolvedByName??'Pending']],`${v.voucherNo}-${state}-internal-voucher.pdf`);
  if(v.exportShipmentId) return downloadPurchaseDocument(v.side==='BUY'?"FZCO SUPPLIER PAYMENT":"FZCO BUYER RECEIPT",v.voucherNo,v.voucherDate,[
    ["Status",state],["Commodity",v.commodityCode??"-"],["Counterparty",v.counterpartyName],["Trade reference",v.tradeRef??"-"],["BL",v.blNo??"-"],
    ["Amount",v.amountUsd!=null?`${v.amountUsd.toFixed(2)} USD`:money(v.amountPkr)],["Shipment details",v.note??"-"],
    ["Method",v.method??"Pending Finance"],["Bank",v.bankName??"-"],["Payment reference",v.reference??"Pending payment"],["Prepared by",v.enteredByName],["Finance approval",v.resolvedByName??"Pending"]
  ],`${v.voucherNo}-${state}-shipment-voucher.pdf`);
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
