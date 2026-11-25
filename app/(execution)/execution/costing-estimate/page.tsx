"use client";
import {useState} from 'react';
import {useExecutionCommodityDesk} from '@/components/execution/commodity-desk-provider';
import {PkeCostEstimate} from '@/components/execution/pke-cost-estimate';
import {TradeCosting} from "@/components/execution/pke-trade-costing";
export default function CostingEstimatePage(){
 const [mode,setMode]=useState("trade");
 const {active,entity}=useExecutionCommodityDesk();
 const [amount,setAmount]=useState(''),[quantity,setQuantity]=useState(''),[currency,setCurrency]=useState<'USD'|'PKR'>('USD'),[basis,setBasis]=useState('total');
 if(active.code!=='PKE'||entity!=='PAK')return <p className="p-6">Costing Estimate is available in Pakistan PKE execution.</p>;
 return <div className="kastros-desk-page space-y-4"><h1 className="text-2xl font-semibold">Costing Estimate</h1><div className="flex gap-3">{["trade","calculator"].map(m=><button key={m} className={mode===m?"kastros-btn-primary":"kastros-btn-secondary"} onClick={()=>setMode(m)}>{m==="trade"?"Trade costing":"Calculator"}</button>)}</div>{mode==="trade"?<TradeCosting/>:<><div className="kastros-card grid gap-4 p-4 md:grid-cols-4"><label className="text-sm">Value basis<select className="kastros-select mt-1 w-full" value={basis} onChange={e=>setBasis(e.target.value)}><option value="total">Total trade value</option><option value="rate">Rate per MT</option></select></label><label className="text-sm">Currency<select className="kastros-select mt-1 w-full" value={currency} onChange={e=>setCurrency(e.target.value as 'USD'|'PKR')}><option>USD</option><option>PKR</option></select></label><label className="text-sm">{basis==='total'?'Trade value (CFR)':'CFR rate / MT'}<input className="kastros-input mt-1 w-full" type="number" min="0" step="any" value={amount} onChange={e=>setAmount(e.target.value)}/></label><label className="text-sm">Quantity (MT)<input className="kastros-input mt-1 w-full" type="number" min="0" step="any" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label></div><PkeCostEstimate editable invoiceAmount={Number(amount)*(basis==='rate'?Number(quantity):1)} quantityMt={Number(quantity)} currency={currency}/></>}</div>;
}
