import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import type { PkeImportPayload } from '@/lib/pke-import';
import { pkeImportSale, tradeEntity } from '@/lib/sesame-entity';

export type PkePaymentSelection = {fileId:string; bl:boolean; lcId?:string};
type Snapshot = PkePaymentSelection & {blNo:string|null;lcReference:string|null;currency:string;amount:number;side:string};
const number=(v:unknown)=>Number(v??0);
const round=(v:number)=>Math.round(v*100)/100;
export async function pkePaymentOptions(tradeRef:string, db:Prisma.TransactionClient=prisma, excludeId?:string) {
 const trade=await db.trade.findUnique({where:{tradeRef},include:{commodity:true}});
 if(!trade||trade.commodity.code!=='PKE')return [];
 const internal=pkeImportSale('PKE',trade.direction,trade.tradeParams);
 if(!internal&&(trade.direction!=='BUY'||tradeEntity(trade.tradeParams)!=='FZCO'))return [];
 const side=internal?'PAK_DUBAI':'DUBAI_SUPPLIER';
 const files=await db.pkeImportFile.findMany({where:internal?{payload:{path:['references','Dubai sale trade reference'],equals:tradeRef}}:{purchaseTradeRef:tradeRef}});
 const vouchers=await db.voucher.findMany({where:{tradeRef,status:{not:'REJECTED'},...(excludeId?{id:{not:excludeId}}:{})},select:{pkePayment:true,status:true}});
 const allocations=vouchers.map(v=>({payment:v.pkePayment as Snapshot|null,status:v.status}));
 return files.map(file=>{
  const payload=file.payload as unknown as PkeImportPayload;
  const rows=allocations.filter(v=>v.payment?.fileId===file.id&&v.payment.side===side);
  const blAmount=number(payload.references[internal?'Dubai BL invoice amount':'Supplier BL invoice amount']);
  const blUsed=rows.filter(v=>v.payment?.bl).reduce((s,v)=>s+number(v.payment?.amount),0);
  return {fileId:file.id,title:file.title,side,paymentType:trade.paymentType,currency:trade.currency,blNo:payload.references['Bill of lading']||null,blAmount,
   blAvailable:round(Math.max(0,blAmount-blUsed)),
   lcs:(payload.lcs??[]).filter(l=>l.side===side&&trade.paymentType==='LC').map(l=>{
    const lcRows=allocations.filter(v=>v.payment?.side===side&&(v.payment.lcReference===l.reference||(v.payment.fileId===file.id&&v.payment.lcId===l.id)));
    const used=lcRows.reduce((s,v)=>s+number(v.payment?.amount),0);
    const paid=lcRows.filter(v=>v.status==='APPROVED').reduce((s,v)=>s+number(v.payment?.amount),0);
    return {...l,used:round(used),paid:round(paid),available:round(Math.max(0,number(l.amount)-used))};
   })};
 });
}
export async function reservePkePayment(db:Prisma.TransactionClient,tradeRef:string,selection:PkePaymentSelection|undefined,amountPkr:number,fx:number,excludeId?:string) {
 const paymentTrade=await db.trade.findUnique({where:{tradeRef},include:{commodity:true}});
 if(paymentTrade?.commodity.code==='PKE'){
  if(paymentTrade.paymentType==='LC'&&!selection?.lcId)throw new Error('Select an LC for this Letter of Credit trade');
  if(paymentTrade.paymentType!=='LC'&&selection?.lcId)throw new Error('LC allocation is only available for Letter of Credit terms; CAD requires no LC');
 }
 if(!selection)return undefined;
 // Lock the document row too: LC edits and payment reservations must not race.
 await db.$queryRaw`SELECT id FROM "PkeImportFile" WHERE id=${selection.fileId} FOR UPDATE`;
 const option=(await pkePaymentOptions(tradeRef,db,excludeId)).find(f=>f.fileId===selection.fileId);
 if(!option)throw new Error('Import file does not belong to this PKE payment trade');
 const amount=round(amountPkr/(option.currency==='USD'?fx:1));
 if(!Number.isFinite(amount)||amount<=0)throw new Error('Invalid payment exchange rate');
 if(!selection.bl&&!selection.lcId)throw new Error('Select a BL or an LC for this import payment');
 if(selection.bl&&(!option.blNo||option.blAmount<=0))throw new Error('Save the BL reference and invoice amount in Import Files first');
 if(selection.bl&&amount>option.blAvailable+.005)throw new Error('Payment exceeds the BL balance including pending vouchers');
 const lc=selection.lcId?option.lcs.find(l=>l.id===selection.lcId):undefined;
 if(selection.lcId&&(!lc||!lc.reference))throw new Error('Select a saved LC for the correct payment side');
 if(lc&&lc.currency!==option.currency)throw new Error('LC currency must match the trade currency; cross-currency LC payments are not supported');
 if(lc&&amount>lc.available+.005)throw new Error('Payment exceeds the remaining LC limit including pending vouchers');
 return {...selection,blNo:selection.bl?option.blNo:null,lcReference:lc?.reference??null,currency:option.currency,amount,side:option.side};
}
export async function validatePkePaymentApproval(db:Prisma.TransactionClient,v:{id:string;tradeRef:string|null;pkePayment:Prisma.JsonValue;amountPkr:unknown;paymentFxRate:unknown}) {
 if(!v.pkePayment||!v.tradeRef)return;
 const saved=v.pkePayment as Snapshot;
 const current=await reservePkePayment(db,v.tradeRef,saved,number(v.amountPkr),number(v.paymentFxRate),v.id);
 if(!current||current.blNo!==saved.blNo||current.lcReference!==saved.lcReference||current.currency!==saved.currency)throw new Error('Import BL or LC changed. Reject and regenerate this voucher');
}
export function pkePaymentNote(p:{blNo:string|null;lcReference:string|null}|undefined){return p?[p.blNo?`Import BL ${p.blNo}`:null,p.lcReference?`LC ${p.lcReference}`:null].filter(Boolean).join(' · '):'';}
