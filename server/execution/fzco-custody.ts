import type {Prisma} from '@prisma/client';
import {sesameGrade} from '@/lib/sesame-processing';
import {tradeEntity} from '@/lib/sesame-entity';
type DB=Prisma.TransactionClient;
const n=(v:unknown)=>Number(v??0);
export async function custodyRows(db:DB,code:string){
 const [entries,dispatches,groups]=await Promise.all([
  db.sesameOwnershipEntry.findMany({where:{commodityCode:code},include:{trade:{select:{tradeParams:true,counterparty:{select:{name:true}}}}}}),
  db.outboundDispatch.findMany({where:{status:'AT_GATE',trade:{commodity:{code}}},include:{trade:{select:{tradeParams:true}}}}),
  db.sesameExportShipment.findMany({where:{directThirdParty:true,status:{notIn:['RELEASED','BL_RECORDED']},trade:{direction:'SELL',commodity:{code}}},include:{trade:{select:{tradeParams:true}}}}),
 ]);
 const holders=await db.counterparty.findMany({where:{id:{in:entries.flatMap(e=>e.holderId?[e.holderId]:[])}}});
 const rows=new Map<string,{warehouseName:string|null;holderId:string|null;holder:string;location:string;grade:ReturnType<typeof sesameGrade>;ownedMt:number;reservedMt:number;availableMt:number}>();
 const key=(wh:string|null,holder:string|null,location:string,grade:string)=>JSON.stringify([wh,holder,location.trim().toLowerCase(),grade]);
 for(const e of entries){const grade=sesameGrade(e.trade.tradeParams),location=e.warehouseName??e.holderLocation??'Unspecified (legacy)';const k=key(e.warehouseName,e.holderId,location,grade);const row=rows.get(k)??{warehouseName:e.warehouseName,holderId:e.holderId,holder:e.warehouseName?'Kastros Pakistan':holders.find(h=>h.id===e.holderId)?.name??'Unspecified (legacy)',location,grade,ownedMt:0,reservedMt:0,availableMt:0};row.ownedMt+=(e.toEntity==='FZCO'?n(e.quantityMt):0)-(e.fromEntity==='FZCO'?n(e.quantityMt):0);rows.set(k,row);}
 for(const d of dispatches){if(tradeEntity(d.trade.tradeParams)!=='FZCO')continue;const row=rows.get(key(d.warehouseName,null,d.warehouseName,sesameGrade(d.trade.tradeParams)));if(row)row.reservedMt+=n(d.allocatedQtyMt);}
 for(const g of groups){const row=rows.get(key(null,g.holderId,g.dispatchLocation??'',sesameGrade(g.trade.tradeParams)));if(row)row.reservedMt+=n(g.totalWeightKg)/1000;}
 return [...rows.values()].map(r=>({...r,availableMt:r.ownedMt-r.reservedMt}));
}
export async function assertCustody(db:DB,code:string,grade:ReturnType<typeof sesameGrade>,qtyMt:number,source:{warehouseName?:string;holderId?:string;location?:string},release=false){
 const row=(await custodyRows(db,code)).find(r=>r.grade===grade&&(source.warehouseName?r.warehouseName===source.warehouseName:!r.warehouseName&&r.holderId===source.holderId&&r.location.trim().toLowerCase()===source.location?.trim().toLowerCase()));
 if(!row||(release?row.ownedMt:row.availableMt)+.000001<qtyMt)throw new Error('Insufficient FZCO-owned '+grade+' stock at this holder and location');
}
