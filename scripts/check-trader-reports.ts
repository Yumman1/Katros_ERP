/** Integration test: empty disposable local database only. */
import assert from 'node:assert/strict';
import {prisma} from '../server/db';
import {appRouter} from '../server/routers/_app';
import {assignCommodityTrader} from '../server/commodity-assignments';
import {cornInOut,cornNoteDirection,cornNoteStatus} from '../lib/reports/corn-counterparty';
async function main(){
 const url=new URL(process.env.POSTGRES_PRISMA_URL!);assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.port==='55433');assert.equal(await prisma.user.count(),0);
 assert.equal(cornInOut(29.235,2410,2670),-190027.5);assert.equal(cornInOut(100,null,2400),null);
 for(const side of ['BUY','SELL'] as const)for(const entry of ['DEBIT','CREDIT'] as const){const d=cornNoteDirection(side,entry);assert.equal(d,(side==='BUY')===(entry==='CREDIT')?'RECEIVABLE':'PAYABLE');assert.equal(cornNoteStatus(d,true,100),d==='RECEIVABLE'?'Received':'Paid');}
 const admin=await prisma.user.create({data:{email:'admin@example.invalid',name:'Admin',role:'CEO',passwordHash:'test'}});
 const trader=await prisma.user.create({data:{email:'trader@example.invalid',name:'Report Trader',role:'TRADER',passwordHash:'test'}});
 const other=await prisma.user.create({data:{email:'other@example.invalid',name:'Other',role:'TRADER',passwordHash:'test'}});
 const corn=await prisma.commodity.create({data:{code:'CORN',name:'Corn',category:'GRAINS',unit:'MT',createdById:admin.id}});
 const ses=await prisma.commodity.create({data:{code:'SES',name:'Sesame',category:'OILSEEDS',unit:'MT',createdById:admin.id}});
 for(const c of [corn,ses])await assignCommodityTrader({commodityId:c.id,traderId:trader.id,expectedVersion:0,actorId:admin.id});
 const cp=await prisma.counterparty.create({data:{code:'CP1',name:'Example',country:'Pakistan',type:'TRADING_PARTNER',createdById:admin.id}});
 const caller=(u=trader,code?:string)=>appRouter.createCaller({prisma,executionCommodityCode:code,session:{user:{id:u.id,name:u.name,email:u.email,role:u.role,isHead:u.isHead},expires:'2099-01-01'}});
 for(const [ref,status,name,currency] of [['OPEN','LOCKED',trader.name,'PKR'],['CANCEL','CANCELLED',trader.name,'PKR'],['OTHER','LOCKED',other.name,'PKR']] as const){
  await prisma.trade.create({data:{createdById:trader.id,tradeRef:ref,tradeDate:new Date(),traderName:name!,direction:'SELL',commodityId:corn.id,counterpartyId:cp.id,quantity:100,quantityUnit:'MT',price:2410,currency,deliveryStart:new Date(),deliveryEnd:new Date(),tradeStatus:status,contract:{create:{tradeRef:ref,contractDate:new Date(),direction:'SELL',executionProfile:'SALE_EX_WAREHOUSE',tradeScope:'LOCAL',incoterms:'Ex Warehouse',commodityCode:'CORN',commodityName:'Corn',counterpartyName:cp.name,counterpartyCode:cp.code,quantityUnit:'MT',contractualQtyMt:100,receivedQtyMt:70.765,openQtyMt:29.235,qualityTolerances:{},ratePerMaund:2410,currency,traderName:name!,lockedAt:new Date(),lockedBy:'Admin'}}}});
 }
 await prisma.counterpartyLedgerEntry.create({data:{counterpartyId:cp.id,side:'SELL',entryType:'DEBIT',amountPkr:10000,sourceType:'ADJUSTMENT',sourceRef:'DN-TEST',tradeRef:'CANCEL',noteStatus:'UNPAID'}});
 await prisma.voucher.create({data:{voucherNo:'V-TEST',counterpartyId:cp.id,side:'SELL',tradeRef:'CANCEL',noteRef:'DN-TEST',amountPkr:2000,status:'APPROVED',enteredByName:'Admin'}});
 const input={commodityId:corn.id,season:'SUMMER' as const,side:'SELL' as const,todayRatePkrPerMaund:2670};
 const report=await caller().trader.cornCounterpartyReport(input);assert.equal(report.groups.length,1);const g=report.groups[0];assert.equal(g.trades.length,1);assert.equal(g.openMt,29.235);assert.equal(g.inOutPkr,-190027.5);assert.equal(g.notes.length,1);assert.equal(g.notes[0].status,'Partly received');assert.equal(g.notes[0].paidPkr,2000);assert.equal(g.notes[0].remainingPkr,8000);assert.equal(g.receivablePkr,8000);assert.equal(g.netPkr,8000);
 await assert.rejects(()=>caller(other).trader.cornCounterpartyReport(input));
 const noRate=await caller().trader.cornCounterpartyReport({...input,todayRatePkrPerMaund:undefined});assert.equal(noRate.rate,null);assert.equal(noRate.groups[0].inOutPkr,null);
 await prisma.executionContract.update({where:{tradeRef:'OPEN'},data:{currency:'USD'}});
 const foreign=await caller().trader.cornCounterpartyReport(input);assert.equal(foreign.groups[0].trades[0].lockedRate,null);assert.equal(foreign.groups[0].inOutPkr,null);
 await prisma.counterpartyLedgerEntry.updateMany({where:{sourceRef:'DN-TEST'},data:{noteStatus:'PAID'}});
 const settled=await caller().trader.cornCounterpartyReport(input);assert.equal(settled.groups[0].notes[0].status,'Received');assert.equal(settled.groups[0].notes[0].remainingPkr,0);assert.equal(settled.groups[0].netPkr,0);
 const a=await caller().sesameExecution.book({commodityCode:'SES'});const b=await caller(admin,'SES').sesameExecution.book();assert.deepEqual(a.positions,b.positions);
 await assert.rejects(()=>caller(other).sesameExecution.book({commodityCode:'SES'}));
 console.log('PASS: workbook MTM, partial open quantities, cancelled and other trader exclusion, note receipts, missing rates, access control, shared Sesame positions');
}
main().finally(()=>prisma.$disconnect());
