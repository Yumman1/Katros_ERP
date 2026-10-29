import assert from 'node:assert/strict';
import {test} from 'node:test';
import {canonicalizeInternalPakSale,deskSide,closesOnPayment,presentTraderBook,internalTrade} from './sesame-entity';
import {normalizePkeReferences,PKE_UPLOAD_FIELDS,pkeRemaining,pkeReceiptProgress} from './pke-import';
test('PKE Dubai resale mirrors as one Pakistan purchase and stays a sale for trader',()=>{
 const c=canonicalizeInternalPakSale('PKE','SELL',{tradingEntity:'Kastros FZCO',internalCounterpartyEntity:'PAK'});
 assert.equal(c.direction,'BUY');assert.equal(c.internalPakSale,false);
 assert.equal(deskSide('PKE',c.direction,c.params,'FZCO'),'SELL');
 assert.equal(deskSide('PKE',c.direction,c.params,'PAK'),'BUY');
 assert.equal(internalTrade('PKE',c.direction,c.params),true);
 assert.equal(closesOnPayment('PKE',c.direction,'INTERNATIONAL',c.params),false);
 const [shown]=presentTraderBook([{commodity:{code:'PKE'},direction:c.direction,tradeParams:c.params,counterparty:{name:'Dubai FZCO'}}]);
 assert.equal(shown.direction,'SELL');assert.equal(shown.counterparty.name,'Kastros Pakistan');
 assert.deepEqual(canonicalizeInternalPakSale('PKE',c.direction,c.params),c);
});
test('PKE supplier quantities close on receipt; sesame retains payment closure',()=>{
 const params={tradingEntity:'Kastros FZCO'};
 assert.equal(closesOnPayment('PKE','BUY','INTERNATIONAL',params),false);
 assert.equal(closesOnPayment('SES','BUY','INTERNATIONAL',params),true);
 assert.equal(pkeRemaining(100,40),60);assert.equal(pkeRemaining(100,100),0);
});
test('phyto reference always follows permit; documents exclude generated contracts/invoices',()=>{
 assert.equal(normalizePkeReferences({'Pakistan import permit':'IP-32','Phytosanitary certificate':'old'})['Phytosanitary certificate'],'IP-32');
 assert.ok(PKE_UPLOAD_FIELDS.includes('Certificate of origin'));
 assert.ok(PKE_UPLOAD_FIELDS.includes('Bill of lading'));
 assert.ok(!PKE_UPLOAD_FIELDS.some(f=>/invoice|contract/i.test(f)));
});

test('partial receipts preserve the remainder and reject over-receipt',()=>{
 assert.deepEqual(pkeReceiptProgress(100,0,40),{received:40,open:60,closed:false});
 assert.deepEqual(pkeReceiptProgress(100,40,60),{received:100,open:0,closed:true});
 assert.throws(()=>pkeReceiptProgress(100,40,61),/exceeds/);
 assert.throws(()=>pkeReceiptProgress(100,100,1),/exceeds/);
 assert.throws(()=>pkeReceiptProgress(100,0,0),/positive/);
 assert.throws(()=>pkeReceiptProgress(100,0,NaN),/positive/);
});
