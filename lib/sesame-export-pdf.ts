import type {inferRouterOutputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
import {downloadPurchaseDocument} from './purchase-document-pdf';
type Shipment=inferRouterOutputs<AppRouter>['sesameExport']['list'][number];
export async function downloadSesameExport(s:Shipment,kind:'DO'|'GATE_OUT'){
 const ref=(kind==='DO'?s.deliveryOrderNo:s.gateOutSlipNo)??'DRAFT';
 const title=kind==='DO'?'DELIVERY ORDER':s.directThirdParty?'COLLECTIVE DISPATCH RECORD':'COLLECTIVE GATE-OUT SLIP';
 const fmt=(n:number)=>n.toLocaleString('en-PK',{maximumFractionDigits:3});
 const rows:string[][]=[['Status',s.status.replaceAll('_',' ')+(s.status==='REJECTED'?' - VOID':'')],['Trade / side',`${s.tradeRef} / ${s.side}`],['Entity / commodity',`${s.entity} / ${s.commodityCode}`],['Counterparty',s.counterparty],[s.directThirdParty?'Dispatch location':'Warehouse',s.dispatchLocation||s.warehouseName]];
 if(s.sourcePurchaseTradeRef)rows.push(['Triparty contract','Supplier → Dubai FZCO → Buyer'],['Supplier',s.supplier??'-'],['Supplier purchase',s.sourcePurchaseTradeRef],['Buyer',s.counterparty],['Buyer sale',s.tradeRef]);
 if(s.triparty)rows.push(['Triparty contract','Kastros Pakistan → Dubai FZCO → Buyer'],['FZCO buyer',s.buyer??'-'],['FZCO sale',s.fzcoSaleTradeRef??'-']);
 if(s.blNo)rows.push(['BL',s.blNo]);
 for(const [i,t] of s.trucks.entries())rows.push([`Container / truck ${i+1}`,`Truck: ${t.truckNo}\nContainer: ${t.containerNo||'-'}\nCRO: ${t.croNo||'-'}\nWeight: ${fmt(t.weightKg)} kg`]);
 rows.push(['Total weight',`${fmt(s.totalWeightKg)} kg (${fmt(s.totalWeightKg/1000)} MT)`],['Trader approval',s.traderApprovedBy??'Pending'],['Execution approval',s.executionApprovedBy??'Pending'],['Finance approval',s.financeApprovedBy??'Pending'],['Release acknowledgement','Applies only to the containers listed above.\nSignature: __________________']);
 return downloadPurchaseDocument(title,ref,s.createdAt,rows,`${ref}_${s.status}.pdf`);
}
