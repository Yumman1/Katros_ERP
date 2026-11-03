import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Prisma} from '@prisma/client';
import {pkePortRows,guardPkePortBooking} from './pke-port';
function fixture(){
 const file={id:'file',title:'BL1',purchaseTradeRef:'BUY',payload:{references:{'Bill of lading':'BL1','Dubai sale trade reference':'INTERNAL','Vessel name':'Vessel','Arrival port':'Karachi','Vessel arrival date':'2026-11-03','Vessel received MT':'200'}},portMovements:[{kind:'WAREHOUSE',quantityMt:40,saleTradeRef:null},{kind:'PORT_SALE',quantityMt:20,saleTradeRef:'SALE'}]};
 const trades=[{tradeRef:'SALE',direction:'SELL',tradeParams:{pkePortFileId:'file'},quantity:80,counterparty:{name:'Buyer'},contract:{},tradeStatus:'LOCKED'}];
 const db={$queryRaw:async()=>[],pkeImportFile:{findMany:async()=>[file]},trade:{findMany:async()=>trades}} as unknown as Prisma.TransactionClient;
 return {file,trades,db};
}
test('200 MT arrival reconciles 40 warehouse + 20 port sale + 140 at port; 60 reserved',async()=>{
 const f=fixture();const [row]=await pkePortRows(f.db);assert.equal(row.quantityMt,200);assert.equal(row.warehouseMt,40);assert.equal(row.soldMt,20);assert.equal(row.remainingMt,140);assert.equal(row.freeMt,80);assert.equal(row.sales[0].remainingMt,60);
});
test('booking cannot oversell port stock or use a Dubai/international trade',async()=>{
 const f=fixture();const input={code:'PKE',direction:'SELL',params:{tradingEntity:'Kastros PAK',pkePortFileId:'file'},tradeScope:'LOCAL',quantity:80};
 await guardPkePortBooking(f.db,input);
 await assert.rejects(guardPkePortBooking(f.db,{...input,quantity:80.001}),/exceeds/);
 await assert.rejects(guardPkePortBooking(f.db,{...input,tradeScope:'INTERNATIONAL'}),/only for local/);
 await assert.rejects(guardPkePortBooking(f.db,{...input,params:{...input.params,tradingEntity:'Kastros FZCO'}}),/only for local/);
 f.file.payload.references['Vessel name']='';await assert.rejects(guardPkePortBooking(f.db,input),/Record vessel arrival/);
});
test('editing a partially delivered sale preserves its reservation',async()=>{
 const f=fixture();await guardPkePortBooking(f.db,{code:'PKE',direction:'SELL',params:{tradingEntity:'Kastros PAK',pkePortFileId:'file'},tradeScope:'LOCAL',quantity:80,excludeRef:'SALE'});
});
