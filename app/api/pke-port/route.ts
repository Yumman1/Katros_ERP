import {pkeReceiptQuote} from "@/lib/pke-receipt-quote";
import {NextResponse} from 'next/server';
import {getServerSession} from 'next-auth';
import {authOptions} from '@/lib/auth';
import {prisma} from '@/server/db';
import {pkePortRows,recordPkePortMovement,portFileId} from '@/server/execution/pke-port';
import {nextSerial,SERIALS} from '@/server/db/serials';
import {z} from 'zod';
export const dynamic='force-dynamic';
async function actor(write=false){const session=await getServerSession(authOptions);const u=session?.user.id?await prisma.user.findUnique({where:{id:session.user.id}}):null;if(!u||u.disabled||!(write?['EXECUTION','CEO']:['EXECUTION','TRADER','FINANCE','CEO']).includes(u.role))throw new Error('Access denied');return u;}
function failure(e:unknown){return NextResponse.json({error:e instanceof Error?e.message:'Request failed'},{status:400});}
export async function GET(){try{await actor();const trades=await prisma.trade.findMany({where:{commodity:{code:'PKE'},tradeStatus:{not:'CANCELLED'}},include:{contract:true,counterparty:true}});const vouchers=await prisma.voucher.findMany({where:{OR:[{commodityCode:'PKE'},{tradeRef:{in:trades.map(t=>t.tradeRef)}}],status:{not:'REJECTED'}}});const billed=await prisma.counterpartyLedgerEntry.findMany({where:{tradeRef:{in:trades.map(t=>t.tradeRef)},entryType:'DEBIT'},select:{tradeRef:true,side:true,amountPkr:true}});return NextResponse.json({files:await pkePortRows(),warehouses:await prisma.location.findMany({where:{type:'WAREHOUSE'},select:{name:true}}),balances:trades.map(t=>{const paid=vouchers.filter(v=>v.tradeRef===t.tradeRef&&v.side===t.direction&&v.status==='APPROVED').reduce((s,v)=>s+Number(v.amountPkr),0);const pending=vouchers.filter(v=>v.tradeRef===t.tradeRef&&v.side===t.direction&&v.status!=='APPROVED').reduce((s,v)=>s+Number(v.amountPkr),0);const value=Math.max(Number(t.quantity)*1000*Number(t.contract?.ratePerKg??0),billed.filter(b=>b.tradeRef===t.tradeRef&&b.side===t.direction).reduce((sum,b)=>sum+Number(b.amountPkr),0));const fx=t.currency==='USD'?Number((t.tradeParams as Record<string,unknown>)?.executionFxPkrPerUsd??0):1;return {receiptQuote:t.direction==='SELL'&&t.tradeScope==='LOCAL'&&portFileId(t.tradeParams)&&t.contract?pkeReceiptQuote(Number(t.quantity),Number(t.contract.ratePerKg),value,paid,pending):null,tradeRef:t.tradeRef,counterparty:t.counterparty.name,currency:t.currency,amount:fx?value/fx:0,paid:fx?paid/fx:0,pending:fx?pending/fx:0,remaining:fx?Math.max(0,value-paid)/fx:0};})});}catch(e){return failure(e);}}
export async function POST(request:Request){try{const u=await actor(true);const input=await request.json();if(input.action==='receipt-voucher'){
 const data=z.object({tradeRef:z.string(),amountPkr:z.number().finite().positive(),requestKey:z.string().uuid()}).parse(input);
 const result=await prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`port-receipt:${data.tradeRef}`}))::text`;
  const old=await tx.voucher.findUnique({where:{id:data.requestKey}});if(old){if(old.tradeRef!==data.tradeRef||Number(old.amountPkr)!==data.amountPkr)throw new Error('Request already used');return {voucherNo:old.voucherNo};}
  const t=await tx.trade.findUniqueOrThrow({where:{tradeRef:data.tradeRef},include:{commodity:true,contract:true}});
  if(t.commodity.code!=='PKE'||t.direction!=='SELL'||t.tradeScope!=='LOCAL'||!portFileId(t.tradeParams)||!t.contract||!['LOCKED','CONFIRMED','EXECUTED'].includes(t.tradeStatus))throw new Error('Select a locked local PKE port sale');
  const due=await tx.counterpartyLedgerEntry.aggregate({where:{tradeRef:t.tradeRef,side:'SELL',entryType:'DEBIT'},_sum:{amountPkr:true}});
  const committed=await tx.voucher.aggregate({where:{tradeRef:t.tradeRef,side:'SELL',status:{not:'REJECTED'}},_sum:{amountPkr:true}});
  const total=Math.max(Number(due._sum.amountPkr??0),Number(t.quantity)*1000*Number(t.contract.ratePerKg));
  if(data.amountPkr+Number(committed._sum.amountPkr??0)>total+.005)throw new Error('Receipt exceeds the remaining sale balance including pending vouchers');
  const voucherNo=await nextSerial(SERIALS.VOUCHER,tx);
  await tx.voucher.create({data:{id:data.requestKey,voucherNo,tradeRef:t.tradeRef,counterpartyId:t.counterpartyId,commodityCode:'PKE',executionEntity:'PAK',side:'SELL',amountPkr:data.amountPkr,voucherKind:'PKE_PORT_SALE',enteredByName:u.name??u.email,note:'PKE local sale directly from port. Finance records payment reference on approval.'}});return {voucherNo};
 });return NextResponse.json(result);
 }
 const data=z.object({fileId:z.string(),kind:z.literal('PORT_SALE'),quantityMt:z.number().finite().positive(),truckNo:z.string().trim().min(1),builty:z.string().trim().min(1),warehouse:z.string().optional(),saleTradeRef:z.string().optional(),requestKey:z.string().uuid()}).parse(input);
 return NextResponse.json(await recordPkePortMovement(data,u.name??u.email));
 }catch(e){return failure(e);}}
