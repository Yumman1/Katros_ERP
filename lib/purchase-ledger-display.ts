/** Supplier-account presentation. Storage signs remain unchanged for legacy settlement logic. */
export function supplierEntryType(side:string, entry:{entryType:'DEBIT'|'CREDIT';purchaseAdvanceFlow?:boolean}) {
 return side==='BUY'&&entry.purchaseAdvanceFlow?(entry.entryType==='CREDIT'?'DEBIT':'CREDIT'):entry.entryType;
}
export function purchasePaidTotal(entries:{entryType:'DEBIT'|'CREDIT';purchaseAdvanceFlow?:boolean;amountPkr:number;noteStatus?:string|null;settlesNoteRef?:string|null}[]) {
 return entries.filter(e=>!e.noteStatus&&!e.settlesNoteRef).reduce((s,e)=>s+(e.purchaseAdvanceFlow?e.entryType==='CREDIT'?e.amountPkr:0:e.entryType==='DEBIT'?e.amountPkr:0),0);
}
