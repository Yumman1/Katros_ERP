/** Defaults and calculation bases from Book1.xlsx, Provisional Costing, rows 15–52. */
export const PKE_COST_FIELDS = [
 ['customsDutyPct','Customs duty','%'],['additionalCustomsDutyPct','Additional customs duty','%'],['regulatoryDutyPct','Regulatory duty','%'],
 ['salesTaxPct','Sales tax','%'],['additionalSalesTaxPct','Additional sales tax','%'],['incomeTaxPct','Income tax','%'],['additionalIncomeTaxPct','Additional income tax','%'],['cessPct','Infrastructure cess','%'],
 ['insurancePct','Insurance','%'],['landingPct','Landing allowance (tax basis only)','%'],
 ['wharfagePerMt','Wharfage / examination','PKR/MT'],['surveyorPerMt','Surveyor','PKR/MT'],['clearancePerMt','Customs clearance / DPP','PKR/MT'],['fumigationPerMt','Fumigation','PKR/MT'],['terminalPerMt','Terminal handling','PKR/MT'],['bagsPerMt','Bags','PKR/MT'],['transportPerMt','Port-to-warehouse transport','PKR/MT'],['warehousePerMt','Warehouse (3 months)','PKR/MT'],['deliveryPerMt','Customer delivery','PKR/MT'],['exchangeRate','Estimate USD/PKR','PKR/USD'],
] as const;
export type PkeCostKey=typeof PKE_COST_FIELDS[number][0];
export type PkeCostPolicy=Record<PkeCostKey,number>;
export const DEFAULT_PKE_COST_POLICY:PkeCostPolicy={customsDutyPct:0,additionalCustomsDutyPct:0,regulatoryDutyPct:0,salesTaxPct:18,additionalSalesTaxPct:3,incomeTaxPct:2,additionalIncomeTaxPct:1.5,cessPct:0.8,insurancePct:0.06,landingPct:1,wharfagePerMt:35.8,surveyorPerMt:36,clearancePerMt:30,fumigationPerMt:0,terminalPerMt:1966.5,bagsPerMt:1180,transportPerMt:2000,warehousePerMt:225,deliveryPerMt:600,exchangeRate:278.5};
export function pkeCostPolicy(value:unknown):PkeCostPolicy {
 const source=value && typeof value==='object'?value as Record<string,unknown>:{};
 const result={...DEFAULT_PKE_COST_POLICY};
 for(const [key] of PKE_COST_FIELDS)if(typeof source[key]==='number'&&Number.isFinite(source[key]))result[key]=source[key];
 return result;
}
export function validatePkeCostPolicy(p:PkeCostPolicy){
 for(const [key,label,unit] of PKE_COST_FIELDS){const v=p[key];if(!Number.isFinite(v)||v<0||(unit==='%'&&v>100)||(key==='exchangeRate'&&v<=0))throw new Error(`Invalid ${label}`);}
}
export type PkeCostLine={label:string;amount:number;basis?:string;rate?:number;unit?:string};
export function calculatePkeCost(input:{invoiceAmount:number;quantityMt:number;currency:'USD'|'PKR';exchangeRate:number},policy:PkeCostPolicy){
 validatePkeCostPolicy(policy);
 if(!Number.isFinite(input.invoiceAmount)||input.invoiceAmount<=0||!Number.isFinite(input.quantityMt)||input.quantityMt<=0||!Number.isFinite(input.exchangeRate)||input.exchangeRate<=0)throw new Error('Enter a positive trade value, quantity and exchange rate');
 const cfr=input.invoiceAmount*(input.currency==='USD'?input.exchangeRate:1),qty=input.quantityMt;
 const insurance=cfr*policy.insurancePct/100;
 const landing=(cfr+insurance)*policy.landingPct/100;
 const customsBase=cfr+insurance+landing;
 const lines:PkeCostLine[]=[{label:'Trade value (CFR)',amount:cfr},{label:'Insurance',amount:insurance,basis:'CFR value',rate:policy.insurancePct,unit:'%'}];
 const addTax=(key:PkeCostKey,label:string,base:number,basis:string)=>{const amount=base*policy[key]/100;lines.push({label,amount,rate:policy[key],unit:'%',basis});return amount;};
 const duties=addTax('customsDutyPct','Customs duty',customsBase,'Customs value')+addTax('additionalCustomsDutyPct','Additional customs duty',customsBase,'Customs value')+addTax('regulatoryDutyPct','Regulatory duty',customsBase,'Customs value');
 const salesBase=customsBase+duties;
 const sales=addTax('salesTaxPct','Sales tax',salesBase,'Customs value + duties')+addTax('additionalSalesTaxPct','Additional sales tax',salesBase,'Customs value + duties');
 const incomeBase=salesBase+sales;
 const income=addTax('incomeTaxPct','Income tax',incomeBase,'Customs value + duties + sales taxes')+addTax('additionalIncomeTaxPct','Additional income tax',incomeBase,'Customs value + duties + sales taxes');
 const cess=addTax('cessPct','Infrastructure cess',customsBase,'Customs value');
 const addCost=(key:PkeCostKey,label:string)=>{const amount=policy[key]*qty;lines.push({label,amount,rate:policy[key],unit:'PKR/MT'});return amount;};
 let portCharges=0;
 for(const key of ['wharfagePerMt','surveyorPerMt','clearancePerMt','fumigationPerMt','terminalPerMt','bagsPerMt'] as const)portCharges+=addCost(key,PKE_COST_FIELDS.find(f=>f[0]===key)![1]);
 const exPort=cfr+insurance+duties+sales+income+cess+portCharges;
 const exWarehouse=exPort+addCost('transportPerMt','Port-to-warehouse transport')+addCost('warehousePerMt','Warehouse (3 months)');
 const delivered=exWarehouse+addCost('deliveryPerMt','Customer delivery');
 return {lines,customsBase,landingAllowance:landing,taxes:duties+sales+income+cess,exPort,exWarehouse,delivered,perMt:delivered/qty,perBag:delivered/qty/20,usdPerMt:delivered/qty/input.exchangeRate};
}
