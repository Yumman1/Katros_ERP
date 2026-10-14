import type {inferRouterOutputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
type RouterOutputs=inferRouterOutputs<AppRouter>;
type Shipment=RouterOutputs['sesameExport']['list'][number];
export async function downloadSesameExport(s:Shipment,kind:'DO'|'GATE_OUT'){
 const {jsPDF}=await import('jspdf');const doc=new jsPDF();let y=20;
 const line=(value:string,size=10)=>{doc.setFontSize(size);const lines=doc.splitTextToSize(value,178);if(y+lines.length*6>278){doc.addPage();y=20;}doc.setFontSize(size);doc.text(lines,16,y);y+=lines.length*6+2;};
 line('KASTROS - SESAME EXPORT',17);line(kind==='DO'?'Delivery Order':'Collective Gate-Out Slip',14);
 line(`Document: ${kind==='DO'?s.deliveryOrderNo:s.gateOutSlipNo}`);line(`Status: ${s.status.replaceAll('_',' ')}${s.status==='REJECTED'?' - VOID':''}`);
 line(`Trade: ${s.tradeRef} | Entity: ${s.entity}`);line(`Counterparty: ${s.counterparty}`);line(`Warehouse: ${s.warehouseName}`);
 if(s.blNo)line(`BL: ${s.blNo}`);
 line('Truck / Container / CRO / Weight (kg)',11);
 for(const t of s.trucks)line(`${t.truckNo} / ${t.containerNo} / ${t.croNo} / ${t.weightKg.toLocaleString('en-PK',{maximumFractionDigits:3})} kg`);
 line(`Total: ${s.totalWeightKg.toLocaleString('en-PK',{maximumFractionDigits:3})} kg (${(s.totalWeightKg/1000).toFixed(3)} MT)`,13);
 line(`Trader approval: ${s.traderApprovedBy??'Pending'}`);line(`Execution approval: ${s.executionApprovedBy??'Pending'}`);line(`Finance approval: ${s.financeApprovedBy??'Pending'}`);
 line(kind==='DO'?'Release requires the approved collective gate-out slip.':'Applies only to the containers listed above. Warehouse release acknowledgement: __________________');
 doc.save(`${kind==='DO'?s.deliveryOrderNo:s.gateOutSlipNo}_${s.status}.pdf`);
}
