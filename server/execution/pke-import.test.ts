import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Prisma} from '@prisma/client';
import {linkPkeTripartyReceiptTx} from './pke-import';
function fixture(qty=40,prior=0,duplicate=false){
 const mutations:{kind:string;args:unknown}[]=[];
 const file={id:'file',revision:0,purchaseTradeRef:'BUY',payload:{references:{'Dubai sale trade reference':'SALE','Vessel name':'Vessel','Vessel arrival date':'2026-11-03','Vessel received MT':'100'},documents:[],history:[]}};
 const contract={id:'buy-contract',contractualQtyMt:100,quantityUnit:'MT'};
 const purchase={id:'buy',tradeRef:'BUY',commodity:{code:'PKE'},direction:'BUY',tradeParams:{tradingEntity:'Kastros FZCO'},contract,tradeStatus:'LOCKED',directSettled:false};
 const sale={...purchase,id:'sale',tradeRef:'SALE',tradeParams:{tradingEntity:'Kastros PAK',internalCounterpartyEntity:'FZCO'},contract:{...contract,id:'sale-contract'}};
 const receipt={id:'receipt',tradeRef:'SALE',status:'ALLOCATED',gatepassNo:'GATE1',allocatedQtyMt:qty,pkeTripartyReceipt:duplicate?{}:null,gatepassTruck:{id:'truck',executionEntity:'PAK',commodityCode:'PKE',movementType:'INBOUND',status:'ASSIGNED'}};
 const db={
  $queryRaw:async()=>[],
  pkePortMovement:{aggregate:async()=>({_sum:{quantityMt:0}}),create:async(args:unknown)=>mutations.push({kind:'port',args})},
  pkeImportFile:{findMany:async()=>[{...file,portMovements:[]}],findUniqueOrThrow:async()=>structuredClone(file),update:async(args:unknown)=>mutations.push({kind:'file',args})},
  trade:{findMany:async()=>[],findUniqueOrThrow:async({where}:{where:{tradeRef:string}})=>where.tradeRef==='BUY'?purchase:sale,update:async(args:unknown)=>mutations.push({kind:'trade',args})},
  inboundReceipt:{findUniqueOrThrow:async()=>receipt,aggregate:async()=>({_sum:{allocatedQtyMt:prior+qty}})},
  pkeTripartyReceipt:{aggregate:async()=>({_sum:{quantityMt:prior}}),create:async(args:unknown)=>mutations.push({kind:'link',args})},
  executionContract:{update:async(args:unknown)=>mutations.push({kind:'contract',args})},
 };
 return {db:db as unknown as Prisma.TransactionClient,mutations,receipt};
}
test('triparty links one existing receipt and reduces both contracts without adding inventory',async()=>{
 const f=fixture();await linkPkeTripartyReceiptTx(f.db,{id:'file',receiptId:'receipt',saleTradeRef:'SALE'},'Execution');
 assert.equal(f.mutations.filter(m=>m.kind==='link').length,1);
 const contracts=f.mutations.filter(m=>m.kind==='contract').map(m=>m.args as {data:{openQtyMt:number;receivedQtyMt:number;contractStatus:string}});
 assert.equal(contracts.length,2);
 for(const c of contracts){assert.equal(c.data.openQtyMt,60);assert.equal(c.data.receivedQtyMt,40);assert.equal(c.data.contractStatus,undefined);}
 assert.equal(f.mutations.filter(m=>m.kind==='trade').length,0);
});
test('final received quantity never closes unpaid financial trades',async()=>{
 const f=fixture(60,40);await linkPkeTripartyReceiptTx(f.db,{id:'file',receiptId:'receipt',saleTradeRef:'SALE'},'Execution');
 assert.equal(f.mutations.filter(m=>m.kind==='trade').length,0);
 for(const m of f.mutations.filter(m=>m.kind==='contract'))assert.equal((m.args as {data:{openQtyMt:number}}).data.openQtyMt,0);
});
test('duplicate, over-receipt and wrong-sale gates fail before writes',async()=>{
 for(const f of [fixture(40,0,true),fixture(61,40)]){
  await assert.rejects(linkPkeTripartyReceiptTx(f.db,{id:'file',receiptId:'receipt',saleTradeRef:'SALE'},'Execution'));
  assert.equal(f.mutations.length,0);
 }
 const f=fixture();f.receipt.tradeRef='OTHER';
 await assert.rejects(linkPkeTripartyReceiptTx(f.db,{id:'file',receiptId:'receipt',saleTradeRef:'SALE'},'Execution'));
 assert.equal(f.mutations.length,0);
});
