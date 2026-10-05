"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";

const fmt = (v: number | null, digits = 2): string => v == null ? "—" : v.toLocaleString("en-PK", {maximumFractionDigits: digits});
const cell = "border-b border-border px-4 py-3 text-left whitespace-nowrap";
export function CornCounterpartyReportPanel({commodityId}: {commodityId:string}) {
  const [season,setSeason] = useState<"SUMMER"|"WINTER">("SUMMER");
  const [side,setSide] = useState<"BUY"|"SELL"|"ALL">("SELL");
  const [counterpartyId,setCounterparty] = useState("");
  const [rate,setRate] = useState("");
  const [override,setOverride] = useState<number|undefined>();
  const {data,error,isLoading,isFetching} = trpc.trader.cornCounterpartyReport.useQuery({commodityId,season,side,counterpartyId:counterpartyId||undefined,todayRatePkrPerMaund:override},{refetchInterval:60_000});
  const totalMt=data?.groups.reduce((s,g)=>s+g.openMt,0)??0;
  const totalSpread=data?.groups.some(g=>g.inOutPkr==null)?null:data?.groups.reduce((s,g)=>s+(g.inOutPkr??0),0)??0;
  function download() {
    if(!data)return;
    const rows: (string|number|null)[][] = [["Corn counterparty report",season,side],["Reference rate PKR / 40 kg maund",data.rate,data.rateSource,data.rateDate],["Counterparty","Trade / note","Side / kind","Open MT","Locked rate","Reference rate","In / Out PKR","Issued PKR","Paid / received PKR","Remaining PKR","Status"]];
    for(const g of data.groups) {
      for(const t of g.trades) rows.push([g.name,t.tradeRef,t.side,t.openMt,t.lockedRate,t.todayRate,t.inOutPkr]);
      for(const n of g.notes) rows.push([g.name,n.reference+" / "+n.tradeRef,n.kind,null,null,null,null,n.amountPkr,n.paidPkr,n.remainingPkr,n.status]);
      rows.push([g.name,"Counterparty total","",g.openMt,null,null,g.inOutPkr]);
      rows.push([g.name,"All Corn ledger: they owe us",g.receivablePkr],[g.name,"All Corn ledger: we owe them",g.payablePkr],[g.name,"All Corn ledger: net receivable",g.netPkr]);
    }
    const csv=rows.map(r=>r.map(v=>{const s=v==null?"":String(v);return '"'+(typeof v==="string"&&/^[=+@\-\t\r]/.test(s)?"'":"")+s.replaceAll('"','""')+'"';}).join(",")).join("\r\n");
    const url=URL.createObjectURL(new Blob(["\uFEFF",csv],{type:"text/csv;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download=`Corn-${season}-${side}-report.csv`;a.click();URL.revokeObjectURL(url);
  }
  return <div className="space-y-5">
    <div className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-semibold">Corn counterparty sales report</h1><p className="text-sm text-muted-foreground">Open contracts, reference-sheet MTM, ledger balances and debit / credit notes.</p></div><button className="kastros-btn-secondary" disabled={!data||isFetching} onClick={download}>Export CSV</button></div>
    <div className="kastros-card p-4 flex flex-wrap items-end gap-4">
      <label>Season<select className="kastros-select block" value={season} onChange={e=>{setSeason(e.target.value as typeof season);setCounterparty("");setRate("");setOverride(undefined);}}><option value="SUMMER">Summer</option><option value="WINTER">Winter</option></select></label>
      <label>Trades<select className="kastros-select block" value={side} onChange={e=>{setSide(e.target.value as typeof side);setCounterparty("");}}><option value="SELL">Sales</option><option value="BUY">Purchases</option><option value="ALL">All trades</option></select></label>
      <label>Counterparty<select className="kastros-select block" value={counterpartyId} onChange={e=>setCounterparty(e.target.value)}><option value="">All counterparties</option>{data?.counterparties.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <form className="flex flex-wrap gap-2 items-end" onSubmit={e=>{e.preventDefault();setOverride(rate?Number(rate):undefined);}}><label>Today’s rate (PKR / 40 kg maund)<input className="kastros-input block" type="number" min="0.01" step="0.01" value={rate} placeholder={data?.rate==null?"Enter rate":String(data.rate)} onChange={e=>setRate(e.target.value)} /></label><button className="kastros-btn-primary">Apply rate</button>{override!=null&&<button type="button" className="kastros-btn-secondary" onClick={()=>{setRate("");setOverride(undefined);}}>Use saved rate</button>}</form>
    </div>
    {error&&<p role="alert" className="text-destructive">{error.message}</p>}{isLoading&&<p>Loading report…</p>}
    {data&&<><p className="text-sm text-muted-foreground">Reference rate: {fmt(data.rate)} PKR / maund · {data.rateSource}{data.rateDate?` · dated ${data.rateDate.slice(0,10)}`:""}. In/Out = (locked rate − reference rate) × open MT × 25, matching your MTM sheet. This spread is separate from ledger cash balances.</p>
      {data.rate==null&&<p role="status">Enter today’s rate to calculate In/Out of money.</p>}
      <div className="grid sm:grid-cols-2 gap-4"><div className="kastros-card p-4">Open quantity<div className="text-2xl font-semibold">{fmt(totalMt,3)} MT</div></div><div className="kastros-card p-4">In / Out of money<div className="text-2xl font-semibold">{fmt(totalSpread)} PKR</div>{totalSpread==null&&<p className="text-sm">One or more trades need a comparable PKR rate.</p>}</div></div>
      <p className="text-sm text-muted-foreground">Trades and notes are limited to your selected book. Ledger balances show each counterparty’s entire Corn account across seasons and purchases / sales, once per counterparty.</p>
      {!data.groups.length&&<p className="kastros-card p-5">No open contracts or debit / credit notes for these filters.</p>}
      {data.groups.map(g=><section key={g.id} className="kastros-card p-5 space-y-4"><h2 className="text-xl font-semibold">{g.name} <span className="text-sm text-muted-foreground">{g.code}</span></h2>
        <div className="flex flex-wrap gap-6 text-sm"><p>They owe us: <strong>{fmt(g.receivablePkr)} PKR</strong></p><p>We owe them: <strong>{fmt(g.payablePkr)} PKR</strong></p><p>Net: <strong>{g.netPkr===0?"Settled":`${fmt(Math.abs(g.netPkr))} PKR — ${g.netPkr>0?"they owe us":"we owe them"}`}</strong></p></div>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{["Trade","Side","Open MT","Locked PKR / maund","Today / reference PKR / maund","In / Out PKR"].map(h=><th key={h} className={cell}>{h}</th>)}</tr></thead><tbody>{g.trades.map(t=><tr key={t.tradeRef}><td className={cell}>{t.tradeRef}</td><td className={cell}>{t.side}</td><td className={cell}>{fmt(t.openMt,3)}</td><td className={cell}>{fmt(t.lockedRate)}{t.rateIssue&&<span className="block text-xs">{t.rateIssue}</span>}</td><td className={cell}>{fmt(t.todayRate)}</td><td className={cell}>{fmt(t.inOutPkr)}</td></tr>)}<tr className="font-semibold"><td className={cell} colSpan={2}>Total</td><td className={cell}>{fmt(g.openMt,3)}</td><td className={cell} colSpan={2}></td><td className={cell}>{fmt(g.inOutPkr)}</td></tr></tbody></table></div>
        <h3 className="font-semibold">Debit / credit notes</h3>{!g.notes.length?<p className="text-sm text-muted-foreground">No notes issued for the selected trades.</p>:<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{["Note","Trade","Type","Issued PKR","Paid / received PKR","Remaining PKR","Settlement status"].map(h=><th key={h} className={cell}>{h}</th>)}</tr></thead><tbody>{g.notes.map(n=><tr key={n.reference}><td className={cell}>{n.reference}</td><td className={cell}>{n.tradeRef}</td><td className={cell}>{n.kind}</td><td className={cell}>{fmt(n.amountPkr)}</td><td className={cell}>{fmt(n.paidPkr)}</td><td className={cell}>{fmt(n.remainingPkr)}</td><td className={cell}><span className="rounded border border-border px-2 py-1">{n.status}</span></td></tr>)}</tbody></table></div>}
      </section>)}
    </>}
  </div>;
}
