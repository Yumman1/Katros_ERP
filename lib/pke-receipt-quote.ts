/** Locked rates are already normalized to PKR/kg by execution. */
export function pkeReceiptQuote(quantityMt:number,ratePkrPerKg:number,billedPkr:number,paidPkr:number,pendingPkr:number){
 const money=(n:number)=>Math.round(n*100)/100;
 const agreedPkr=money(quantityMt*1000*ratePkrPerKg);
 const expectedPkr=money(Math.max(agreedPkr,billedPkr));
 const remainingPkr=money(Math.max(0,expectedPkr-paidPkr));
 return {quantityMt,ratePkrPerKg,agreedPkr,expectedPkr,billedExtraPkr:money(expectedPkr-agreedPkr),paidPkr:money(paidPkr),pendingPkr:money(pendingPkr),remainingPkr,availablePkr:money(Math.max(0,remainingPkr-pendingPkr))};
}
export type PkeReceiptQuote=ReturnType<typeof pkeReceiptQuote>;
