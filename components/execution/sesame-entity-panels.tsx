"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { ENTITY_NAMES, type SesameEntity } from "@/lib/sesame-entity";
import { useExecutionCommodityDesk } from "./commodity-desk-provider";
import { useTeam } from "@/lib/use-team";
import { canActOnDepartment } from "@/lib/departments";

const qty = (value: number) => value.toLocaleString("en-PK", { maximumFractionDigits: 3 });
const cell = "border-b border-border px-4 py-3 text-left";
const input = "kastros-input w-full";
function useBook() { return trpc.sesameExecution.book.useQuery(undefined, { refetchInterval: 30_000 }); }

export function SesamePositions() {
  const { active } = useExecutionCommodityDesk();
  return <SesamePositionView commodityCode={active.code} />;
}

export function SesamePositionView({ commodityCode, canEdit = true }: { commodityCode: string; canEdit?: boolean }) {
  const { data, error, isLoading } = trpc.sesameExecution.positionSnapshot.useQuery({ commodityCode }, { refetchInterval: 30_000 });
  const { data: market } = trpc.trader.seasonNetPositions.useQuery();
  const [fx, setFx] = useState("");
  const [rate, setRate] = useState("");
  const utils = trpc.useUtils();
  const save = trpc.trader.setPositionMarketInput.useMutation({ onSuccess: () => { void utils.trader.seasonNetPositions.invalidate(); void utils.sesameExecution.book.invalidate(); void utils.sesameExecution.positionSnapshot.invalidate(); } });
  if (isLoading) return <p>Loading Sesame positions…</p>;
  if (error) return <p role="alert">{error.message}</p>;
  return <section className="kastros-card p-5 space-y-4"><h2 className="text-xl font-semibold">Sesame positions — Pakistan and Dubai FZCO</h2>
    <p className="text-sm text-muted-foreground">Ownership and open contracts for both entities. Internal transfers move ownership; physical stock leaves Pakistan only on truck release.</p>
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className={cell}>Position (MT)</th>{data?.positions.map(p => <th className={cell} key={p.entity}>{ENTITY_NAMES[p.entity]}</th>)}</tr></thead><tbody>
      {([['Physical inventory','ownedMt'],['Open purchases','openBuyMt'],['Open sales','bookedNotLeftMt'],['Net position','netPositionMt']] as const).map(([label,key]) => <tr key={key}><td className={cell}>{label}</td>{data?.positions.map(p => <td key={p.entity} className={cell}>{qty(p[key])}</td>)}</tr>)}
      {([['Entry rate (PKR / maund)','entryRatePkrPerMaund'],['Market rate (PKR / maund)','marketRatePkrPerMaund'],['In / out (PKR / maund)','inOutPkrPerMaund'],['In / out value (PKR)','inOutValuePkr'],['In / out value (USD)','inOutValueUsd']] as const).map(([label,key]) => <tr key={key}><td className={cell}>{label}</td>{data?.positions.map(p => <td key={p.entity} className={cell}>{p[key] == null ? "—" : qty(p[key])}</td>)}</tr>)}
    </tbody></table></div>
    <p className="text-xs text-muted-foreground">Physical inventory is shown for each owning entity. FZCO inventory may remain in Pakistan until release. Net position = physical inventory + open purchases − open sales.</p>
    {canEdit && <form className="flex flex-wrap gap-3 items-end" onSubmit={e => { e.preventDefault(); save.mutate({ commodityCode, season: "SUMMER", fxRate: Number(fx), ...(rate ? { marketRatePkrPerMaund: Number(rate) } : {}) }); }}>
      <label className="text-sm">Shared USD / PKR rate<input aria-label="Shared USD / PKR rate" className={input} type="number" step="0.01" min="0.01" required value={fx} placeholder={String(market?.find(m => m.commodityCode === commodityCode)?.fxRate ?? "")} onChange={e => setFx(e.target.value)} /></label>
      <label className="text-sm">Shared fallback market rate (PKR / maund)<input className={input} type="number" step="0.01" min="0.01" value={rate} onChange={e => setRate(e.target.value)} /></label>
      <button className="kastros-btn-primary" disabled={save.isPending}>Save rate</button>
      {save.error && <p role="alert">{save.error.message}</p>}{save.isSuccess && <p role="status">Rate saved. Locked contracts retain their saved rate.</p>}
    </form>}
    <p className="text-xs text-muted-foreground">Pakistan Daily Prices take precedence over the fallback market rate. FZCO entry cost is the weighted cost of confirmed purchases; Pakistan uses its receipt-based purchase cost.</p>
  </section>;
}

export function SesameInventory() {
  const { entity } = useExecutionCommodityDesk();
  const { data, isLoading, error } = useBook();
  const p = data?.positions.find(p => p.entity === entity);
  if (isLoading) return <p>Loading ownership inventory…</p>;
  if (error) return <p role="alert">{error.message}</p>;
  return <div className="kastros-desk-page space-y-5"><h1 className="text-2xl font-semibold">{ENTITY_NAMES[entity]} Sesame inventory</h1>
    <p className="text-sm text-muted-foreground">{entity === "FZCO" ? "Paper ownership, reservations and quantities still awaiting dispatch. FZCO has no physical warehouse." : "Physical Sesame stock in Pakistan, showing the share owned by each entity."}</p>
    <div className="grid gap-4 md:grid-cols-4">{([['Owned stock',p?.ownedMt],['Booked, not left',p?.bookedNotLeftMt],['Free to sell',p?.freeMt],['Loading',p?.loadingMt]] as const).map(([label,value]) => <section key={label} className="kastros-card p-4"><div className="text-sm text-muted-foreground">{label}</div><div className="text-2xl font-semibold mt-2">{qty(value ?? 0)} MT</div></section>)}</div>
    {entity === "PAK" && <div className="kastros-card overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Pakistan warehouse','Physical MT','Pakistan-owned MT','Held for FZCO MT'].map(h => <th key={h} className={cell}>{h}</th>)}</tr></thead><tbody>{data?.warehouses.map(w => <tr key={w.name}><td className={cell}>{w.name}</td><td className={cell}>{qty(w.quantityMt)}</td><td className={cell}>{qty(w.pakistanOwnedMt)}</td><td className={cell}>{qty(w.fzcoOwnedMt)}</td></tr>)}</tbody></table>{!data?.warehouses.length && <p className="p-5">No physical Sesame receipts yet.</p>}</div>}
    <OwnershipTrades />
  </div>;
}

export function OwnershipTrades({ allTrades = false }: { allTrades?: boolean }) {
  const { entity } = useExecutionCommodityDesk();
  const { role, isHead } = useTeam();
  const canConfirm = role != null && canActOnDepartment(role, isHead, "EXECUTION");
  const { data, error, isLoading } = useBook();
  const [ref, setRef] = useState("");
  const [amount, setAmount] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const utils = trpc.useUtils();
  const save = trpc.sesameExecution.confirmOwnership.useMutation({ onSuccess: () => { setRef(""); setAmount(""); void utils.invalidate(); } });
  const rows = data?.trades.filter(t => t.submitted && (t.entity === entity || t.internalEntity === entity) && (allTrades || t.internalEntity || (t.entity === "FZCO" && t.direction === "BUY"))) ?? [];
  const selected = rows.find(t => t.tradeRef === ref);
  if (isLoading) return <p>Loading ownership trades…</p>;
  if (error) return <p role="alert">{error.message}</p>;
  return <section className="kastros-card p-5 space-y-4"><h2 className="text-xl font-semibold">{allTrades ? "FZCO trades" : "Ownership and internal trades"}</h2>
    <p className="text-sm text-muted-foreground">An internal trade appears as a purchase in one entity and a sale in the other. Confirmed ownership does not create a truck movement.</p>
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Trade','Our side','Counterparty','Quantity MT','Ownership confirmed MT','Status','Action'].map(h => <th key={h} className={cell}>{h}</th>)}</tr></thead><tbody>{rows.map(t => {
      const side = t.entity === entity ? t.direction : t.direction === "BUY" ? "SELL" : "BUY";
      const counterparty = t.internalEntity ? ENTITY_NAMES[t.entity === entity ? t.internalEntity : t.entity] : t.counterparty;
      const canRecord = t.status === "LOCKED" && (t.internalEntity || t.direction === "BUY") && t.confirmedMt < t.quantityMt && canConfirm && (!t.internalEntity || entity === "PAK");
      return <tr key={t.tradeRef}><td className={cell}>{t.tradeRef}{t.entity !== entity && <span className="block text-xs text-subtle">Internal counterpart</span>}</td><td className={cell}>{side}</td><td className={cell}>{counterparty}</td><td className={cell}>{qty(t.quantityMt)}</td><td className={cell}>{qty(t.confirmedMt)}</td><td className={cell}>{t.status}</td><td className={cell}>{t.status === "PENDING" && t.entity === entity ? <Link href={`/execution/open-trades/${encodeURIComponent(t.tradeRef)}`} className="text-accent-secondary">Review</Link> : canRecord ? <button className="kastros-btn-secondary" onClick={() => { setRef(t.tradeRef); setAmount(String(t.quantityMt-t.confirmedMt)); setWarehouse(""); }}>Confirm ownership</button> : t.internalEntity && entity === "FZCO" && t.confirmedMt < t.quantityMt ? "Awaiting Pakistan confirmation" : "—"}</td></tr>;
    })}</tbody></table></div>{!rows.length && <p className="text-sm text-muted-foreground">No trades for this entity yet.</p>}
    {selected && <form className="grid gap-3 md:grid-cols-3 border-t border-border pt-4" onSubmit={e => { e.preventDefault(); save.mutate({ tradeRef: ref, quantityMt: Number(amount), warehouseName: warehouse || undefined }); }}>
      <label className="text-sm">Quantity MT<input className={input} type="number" min="0.000001" step="0.000001" max={selected.quantityMt-selected.confirmedMt} required value={amount} onChange={e => setAmount(e.target.value)} /></label>
      {selected.internalEntity && <label className="text-sm">Pakistan custody location<select className="kastros-select w-full" required value={warehouse} onChange={e => setWarehouse(e.target.value)}><option value="">Select stock already held in Pakistan</option>{data?.warehouses.map(w => <option key={w.name} value={w.name}>{w.name} · PAK {qty(w.pakistanOwnedMt)} / FZCO {qty(w.fzcoOwnedMt)} MT</option>)}</select></label>}
      <div className="flex gap-2 items-end"><button className="kastros-btn-primary" disabled={save.isPending}>Confirm {ref}</button><button type="button" className="kastros-btn-secondary" onClick={() => setRef("")}>Cancel</button></div>
    </form>}{save.error && <p role="alert" className="text-destructive">{save.error.message}</p>}
  </section>;
}

export function FzcoOverview() {
  const { selectEntity } = useExecutionCommodityDesk();
  return <div className="kastros-desk-page space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Dubai FZCO — Sesame execution</h1><button className="kastros-btn-secondary" onClick={() => selectEntity("PAK", "/execution/ledgers?entity=FZCO")}>View FZCO ledger in Pakistan</button></div><SesamePositions /><OwnershipTrades allTrades /><Link className="kastros-btn-primary inline-block" href="/execution/movements">Load and release FZCO trucks</Link></div>;
}

export function FzcoTrucks() {
  const { role, isHead } = useTeam();
  const canCancel = role != null && canActOnDepartment(role, isHead, "EXECUTION");
  const { data } = useBook();
  const { data: rows, error } = trpc.execution.saleWorkflowRows.useQuery(undefined, { refetchInterval: 15_000 });
  const [ref, setRef] = useState(""); const [truck, setTruck] = useState(""); const [weight, setWeight] = useState(""); const [transporter, setTransporter] = useState("");
  const utils = trpc.useUtils(); const refresh = () => { void utils.invalidate(); };
  const load = trpc.sesameExecution.loadTruck.useMutation({ onSuccess: () => { setTruck(""); setWeight(""); refresh(); } });
  const order = trpc.execution.generateDeliveryOrder.useMutation({ onSuccess: refresh });
  const gate = trpc.execution.generateGatePass.useMutation({ onSuccess: refresh });
  const release = trpc.execution.markSaleReleased.useMutation({ onSuccess: refresh });
  const credit = trpc.execution.requestClearWithoutPayment.useMutation({ onSuccess: refresh });
  const cancel = trpc.sesameExecution.cancelLoad.useMutation({ onSuccess: refresh });
  const issue = load.error ?? order.error ?? gate.error ?? release.error ?? credit.error ?? cancel.error ?? error;
  return <div className="kastros-desk-page space-y-5"><h1 className="text-2xl font-semibold">FZCO trucks</h1><p className="text-sm text-muted-foreground">Load against FZCO-owned stock. Loading reserves ownership; physical stock leaves Pakistan after approvals and release.</p>
    <form className="kastros-card p-5 grid gap-3 md:grid-cols-2" onSubmit={e => { e.preventDefault(); load.mutate({ tradeRef: ref, truckNo: truck, weightKg: Number(weight), transporterName: transporter }); }}>
      <label>FZCO sale<select className="kastros-select w-full" required value={ref} onChange={e => setRef(e.target.value)}><option value="">Select a locked sale</option>{data?.trades.filter(t => t.entity === "FZCO" && !t.internalEntity && t.direction === "SELL" && t.status === "LOCKED").map(t => <option key={t.tradeRef} value={t.tradeRef}>{t.tradeRef} · {t.counterparty} · {qty(t.openMt)} MT</option>)}</select></label>
      <label>Truck number<input className={input} required value={truck} onChange={e => setTruck(e.target.value)} /></label><label>Load weight (kg)<input className={input} type="number" min="1" step="0.001" required value={weight} onChange={e => setWeight(e.target.value)} /></label><label>Transporter<input className={input} required value={transporter} onChange={e => setTransporter(e.target.value)} /></label>
      <button className="kastros-btn-primary" disabled={load.isPending}>Record load</button>
    </form>{issue && <p className="text-destructive" role="alert">{issue.message}</p>}
    {canCancel && rows?.some(r => r.saleStage === "AWAITING_BALANCE" && !r.deliveryOrderNo) && <section className="kastros-card p-4"><h2 className="font-semibold">Correct an unapproved load</h2><p className="text-sm text-muted-foreground mb-3">Cancel its reservation before recording the corrected truck.</p>{rows.filter(r => r.saleStage === "AWAITING_BALANCE" && !r.deliveryOrderNo).map(r => <button key={r.truckId} className="kastros-btn-secondary mr-2" disabled={cancel.isPending} onClick={() => { if (window.confirm(`Cancel load ${r.truckNo} and return its reserved quantity to FZCO availability?`)) cancel.mutate({ truckId: r.truckId }); }}>Cancel {r.truckNo}</button>)}</section>}
    <div className="kastros-card overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Truck','Trade','Amount PKR','Stage','Action'].map(h => <th className={cell} key={h}>{h}</th>)}</tr></thead><tbody>{rows?.map(r => <tr key={r.truckId}><td className={cell}>{r.truckNo}</td><td className={cell}>{r.tradeRef}</td><td className={cell}>{qty(r.saleExpectedPkr ?? 0)}</td><td className={cell}>{r.saleReleasedAt ? "RELEASED" : r.saleStage}</td><td className={cell}><div className="flex flex-wrap gap-2">{!r.saleReleasedAt && r.canGenerateDo && <button className="kastros-btn-secondary" disabled={order.isPending} onClick={() => order.mutate({ truckId: r.truckId })}>Generate DO</button>}{!r.saleReleasedAt && r.canGenerateGatePass && <button className="kastros-btn-secondary" disabled={gate.isPending} onClick={() => gate.mutate({ truckId: r.truckId })}>Generate gate pass</button>}{!r.saleReleasedAt && r.gateOutSlipNo && <button className="kastros-btn-primary" disabled={release.isPending} onClick={() => release.mutate({ truckId: r.truckId })}>Release truck</button>}{r.saleStage === "AWAITING_BALANCE" && !r.canGenerateDo && <button className="kastros-btn-secondary" disabled={credit.isPending} onClick={() => credit.mutate({ truckId: r.truckId })}>Request credit clearance</button>}{r.deliveryOrderNo && <Link className="text-accent-secondary" href={`/execution/print/delivery-order/${r.truckId}`} target="_blank">Print DO</Link>}{r.gateOutSlipNo && <Link className="text-accent-secondary" href={`/execution/print/gate-out-slip/${r.truckId}`} target="_blank">Print gate pass</Link>}</div></td></tr>)}</tbody></table>{!rows?.length && <p className="p-5">No FZCO trucks yet.</p>}</div>
  </div>;
}

export function SesameInternalLedger({ entity }: { entity?: SesameEntity }) {
  const { data } = useBook();
  const internal = data?.trades.filter(t => t.internalEntity && t.confirmedMt > 0) ?? [];
  return <section className="kastros-card p-5 space-y-3"><h2 className="text-lg font-semibold">Internal ownership ledger</h2><p className="text-sm text-muted-foreground">Confirmed internal purchases and sales, at net trade value in the quoted currency. Payment vouchers remain in the accounts above.</p><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Trade','Entity','Side','Confirmed MT','Net trade value'].map(h => <th key={h} className={cell}>{h}</th>)}</tr></thead><tbody>{internal.flatMap(t => (["PAK","FZCO"] as const).filter(e => !entity || e === entity).map(e => <tr key={`${t.tradeRef}-${e}`}><td className={cell}>{t.tradeRef}</td><td className={cell}>{ENTITY_NAMES[e]}</td><td className={cell}>{e === t.entity ? t.direction : t.direction === "BUY" ? "SELL" : "BUY"}</td><td className={cell}>{qty(t.confirmedMt)}</td><td className={cell}>{qty(t.confirmedValue)} {t.currency}</td></tr>))}</tbody></table></div>{!internal.length && <p className="text-sm text-muted-foreground">No confirmed internal transfers yet.</p>}</section>;
}
