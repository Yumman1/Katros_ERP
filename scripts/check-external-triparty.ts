/** Runs only against an empty disposable local database. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {prisma} from '../server/db';
import {confirmOwnership,sesameBook} from '../server/execution/sesame-ownership';
import {logFzcoIntake,assignFzcoIntake} from '../server/execution/fzco-intake';
import {exportAction,exportReceipt} from '../server/execution/sesame-export';
import {createInternationalPurchase} from '../server/finance/international-purchase';
import {approveVoucher} from '../server/finance/vouchers';
async function main(){
 const url=new URL(process.env.POSTGRES_PRISMA_URL!);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55433');assert.equal(await prisma.user.count(),0);
 const u=await prisma.user.create({data:{name:'Test',email:'test@example.invalid',role:'CEO',passwordHash:'test'}});
 const cp=async(name:string)=>prisma.counterparty.create({data:{name,code:name,country:'UAE',type:'TRADING_PARTNER',createdById:u.id,tradingEntities:['FZCO']}});
 const supplier=await cp('Supplier'),buyer=await cp('Buyer'),wrong=await cp('Wrong');
 const commodity=await prisma.commodity.create({data:{name:'Sesame',code:'SES',unit:'MT',category:'OILSEEDS',createdById:u.id}});
 async function trade(ref:string,side:'BUY'|'SELL',rate:number){
 const t=await prisma.trade.create({data:{tradeRef:ref,tradeDate:new Date(),deliveryStart:new Date(),deliveryEnd:new Date(),traderName:'Test',direction:side,tradeScope:'INTERNATIONAL',tradeStatus:'LOCKED',submittedToExecution:true,commodityId:commodity.id,counterpartyId:side==='BUY'?supplier.id:buyer.id,quantity:20,quantityUnit:'MT',price:rate*1000/280,currency:'USD',ratePerKg:rate,createdById:u.id,tradeParams:{tradingEntity:'Kastros FZCO',sesameType:'Raw',executionFxPkrPerUsd:280}}});
 await prisma.executionContract.create({data:{tradeId:t.id,tradeRef:ref,contractDate:new Date(),direction:side,executionProfile:side==='BUY'?'PURCHASE_DELIVERED':'SALE_EX_WAREHOUSE',tradeScope:'INTERNATIONAL',incoterms:'FOB',commodityCode:'SES',commodityName:'Sesame',counterpartyName:side==='BUY'?supplier.name:buyer.name,counterpartyCode:side==='BUY'?supplier.code:buyer.code,quantityUnit:'MT',contractualQtyMt:20,openQtyMt:20,qualityTolerances:{},currency:'PKR',traderName:'Test',lockedAt:new Date(),lockedBy:'Test',ratePerKg:rate,paperOwnership:true,executionEntity:'FZCO',closeOnPayment:true}});return t;
 }
 const purchase=await trade('PURCHASE','BUY',280),sale=await trade('SALE','SELL',560);
 await confirmOwnership({tradeRef:purchase.tradeRef,quantityMt:20,entity:'FZCO',actor:'Test',holderId:supplier.id,holderLocation:'Supplier store',documentRef:'OWN-1',ownershipDate:new Date(),requestKey:randomUUID()});
 const contract=(ref:string)=>prisma.executionContract.findUniqueOrThrow({where:{tradeRef:ref}});
 const pos=async()=>(await sesameBook('SES')).positions.find(p=>p.entity==='FZCO')!;
 assert.equal((await contract('PURCHASE')).contractStatus,'Open');assert.equal((await pos()).openBuyMt,20);
 const intake={requestKey:randomUUID(),counterpartyId:buyer.id,side:'SELL' as const,commodityCode:'SES',triparty:true,holderId:supplier.id,dispatchLocation:'Supplier store',movementDate:new Date(),transporterName:'Carrier',transporterPhone:'',remarks:'',documentLinks:[],containers:[{truckNo:'T1',containerNo:'C1',croNo:'CRO1',weightKg:10000}]};
 await logFzcoIntake(intake,'Test');await assert.rejects(()=>assignFzcoIntake(intake.requestKey,'SALE','SES','Test'),/supplier purchase/);
 await assert.rejects(()=>assignFzcoIntake(intake.requestKey,'SALE','SES','Test','SALE'),/matching commodity/);
 let s=await assignFzcoIntake(intake.requestKey,'SALE','SES','Test','PURCHASE');assert.equal(s.sourcePurchaseTradeRef,'PURCHASE');assert.equal(s.supplierAmountPkr,2800000);
 const over={...intake,requestKey:randomUUID(),containers:[{truckNo:'T2',containerNo:'C2',croNo:'CRO2',weightKg:11000}]};await logFzcoIntake(over,'Test');await assert.rejects(()=>assignFzcoIntake(over.requestKey,'SALE','SES','Test','PURCHASE'),/remaining trade|Insufficient|enough/);
 for(const action of ['generate','trader','execution','finance','release'] as const)s=await exportAction(s.id,s.revision,'Test',action);
 assert.equal((await contract('PURCHASE')).contractStatus,'Open');assert.equal((await contract('SALE')).contractStatus,'Open');assert.equal((await pos()).openBuyMt,20);assert.equal((await pos()).openSellMt,20);
 s=await exportAction(s.id,s.revision,'Test','bl',{blNo:'BL1'});
 assert.equal(await prisma.counterpartyLedgerEntry.count({where:{tradeRef:'PURCHASE',entryType:'DEBIT'}}),1);
 async function pay(amount:number,shipment?:string){const v=await createInternationalPurchase({tradeRef:'PURCHASE',counterpartyId:supplier.id,exportShipmentId:shipment,amount,voucherDate:new Date(),entity:'FZCO',actor:'Test',userId:u.id,code:'SES'});const row=await prisma.voucher.findUniqueOrThrow({where:{voucherNo:v.voucherNo}});await approveVoucher(row.id,'Finance',undefined,randomUUID(),{method:'Cash'});}
 // Supplier payment is independent of the buyer's payment.
 await pay(10000,s.id);assert.equal((await contract('PURCHASE')).contractStatus,'Open');
 await pay(10000);assert.equal((await contract('PURCHASE')).contractStatus,'Close');assert.equal((await pos()).openBuyMt,0);assert.equal((await pos()).openSellMt,20);
 // Paid purchases remain usable as a stock source.
 const second={...intake,requestKey:randomUUID(),containers:[{truckNo:'T3',containerNo:'C3',croNo:'CRO3',weightKg:10000}]};await logFzcoIntake(second,'Test');let s2=await assignFzcoIntake(second.requestKey,'SALE','SES','Test','PURCHASE');
 for(const action of ['generate','trader','execution','finance','release'] as const)s2=await exportAction(s2.id,s2.revision,'Test',action);
 s2=await exportAction(s2.id,s2.revision,'Test','bl',{blNo:'BL2'});
 for(const group of [s,s2]){const key=randomUUID();await exportReceipt(group.id,'Test',{amountPkr:5600000,method:'Cash',reference:randomUUID(),requestKey:key});await approveVoucher(key,'Finance');if(group.id===s.id)assert.equal((await contract('SALE')).contractStatus,'Open');}
 assert.equal((await contract('SALE')).contractStatus,'Close');assert.equal((await pos()).openSellMt,0);
 assert.equal((await sesameBook('SES')).custody.filter(r=>r.holderId===supplier.id).reduce((a,r)=>a+r.availableMt,0),0);
 await assert.rejects(()=>pay(1),/exceeds/);
 assert.equal(await prisma.inboundReceipt.count(),0);assert.equal(await prisma.outboundDispatch.count(),0);
 console.log('PASS: external triparty, source validation, reservation, physical release, independent partial/full payments, paid-stock dispatch and no duplicate purchase invoice');
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>prisma.$disconnect());
