import type {Prisma} from '@prisma/client';
import {sesameGrade} from '@/lib/sesame-processing';
import {FZCO_NO_PAKISTAN_WAREHOUSE} from '@/lib/sesame-entity';
type DB=Prisma.TransactionClient;
const n=(v:unknown)=>Number(v??0);
export async function custodyRows(db:DB,code:string){
 const [entries,groups]=await Promise.all([
  db.sesameOwnershipEntry.findMany({where:{commodityCode:code,OR:[{warehouseName:null},{warehouseName:''}]},include:{trade:{select:{tradeParams:true,counterparty:{select:{name:true}}}}}}),
  db.sesameExportShipment.findMany({where:{directThirdParty:true,status:{notIn:['RELEASED','BL_RECORDED']},trade:{direction:'SELL',commodity:{code}}},include:{trade:{select:{tradeParams:true}}}}),
 ]);
 const holders=await db.counterparty.findMany({where:{id:{in:entries.flatMap(e=>e.holderId?[e.holderId]:[])}}});
 const rows=new Map<string,{warehouseName:string|null;holderId:string|null;holder:string;location:string;grade:ReturnType<typeof sesameGrade>;ownedMt:number;reservedMt:number;availableMt:number}>();
 const key=(holder:string|null,location:string,grade:string)=>JSON.stringify([holder,location.trim().toLowerCase(),grade]);
 for(const e of entries){const grade=sesameGrade(e.trade.tradeParams),location=e.holderLocation??'';const k=key(e.holderId,location,grade);const row=rows.get(k)??{warehouseName:null,holderId:e.holderId,holder:holders.find(h=>h.id===e.holderId)?.name??'Unspecified (legacy)',location,grade,ownedMt:0,reservedMt:0,availableMt:0};row.ownedMt+=(e.toEntity==='FZCO'?n(e.quantityMt):0)-(e.fromEntity==='FZCO'?n(e.quantityMt):0);rows.set(k,row);}
 for(const g of groups){const row=rows.get(key(g.holderId,g.dispatchLocation??'',sesameGrade(g.trade.tradeParams)));if(row)row.reservedMt+=n(g.totalWeightKg)/1000;}
 return [...rows.values()].map(r=>({...r,availableMt:r.ownedMt-r.reservedMt}));
}
export async function assertCustody(db:DB,code:string,grade:ReturnType<typeof sesameGrade>,qtyMt:number,source:{warehouseName?:string;holderId?:string;location?:string},release=false){
 if(source.warehouseName)throw new Error(FZCO_NO_PAKISTAN_WAREHOUSE);
 const row=(await custodyRows(db,code)).find(r=>r.grade===grade&&!r.warehouseName&&r.holderId===source.holderId);
 if(!row||(release?row.ownedMt:row.availableMt)+.000001<qtyMt)throw new Error('Insufficient FZCO-owned '+grade+' stock held by this supplier');
}
