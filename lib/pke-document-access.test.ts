import test from 'node:test';
import assert from 'node:assert/strict';
import {canUploadPkeDocument,missingDubaiLc,emptyPkeImport} from './pke-import';
test('document ownership separates Dubai supplier LC from Pakistan documents',()=>{
 const p=emptyPkeImport();p.lcs=[{id:'dubai',side:'DUBAI_SUPPLIER',reference:'LC1',bank:'Bank',currency:'USD',amount:'500'},{id:'pak',side:'PAK_DUBAI',reference:'LC2',bank:'Bank',currency:'USD',amount:'600'}];
 assert.equal(canUploadPkeDocument('FZCO','LC:dubai',p),true);
 for(const field of ['LC:pak','Bill of lading','Pakistan import permit','LC:unknown'])assert.equal(canUploadPkeDocument('FZCO',field,p),false);
 assert.equal(canUploadPkeDocument('PAK','LC:dubai',p),false);
 assert.equal(canUploadPkeDocument('PAK','Bill of lading',p),true);
});
test('LC imports require every Dubai LC attachment, CAD remains exempt',()=>{
 const p=emptyPkeImport();assert.equal(missingDubaiLc(p,'CAD'),false);assert.equal(missingDubaiLc(p,'LC'),true);
 p.lcs=[{id:'one',side:'DUBAI_SUPPLIER',reference:'LC1',bank:'Bank',currency:'USD',amount:'500'}];
 assert.equal(missingDubaiLc(p,'LC'),true);
 p.documents=[{id:'doc',field:'LC:one',name:'LC.pdf',path:'lc',uploadedAt:'now',uploadedBy:'Suleiman'}];
 assert.equal(missingDubaiLc(p,'LC'),false);
 p.lcs.push({...p.lcs[0],id:'two'});assert.equal(missingDubaiLc(p,'LC'),true);
});
