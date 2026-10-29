"use client";
import { formatDisplayNumber } from "@/lib/formatters/numbers";
import {FzcoGateAssignment} from "./fzco-gate-assignment";
import {FzcoDirectEntry} from "./fzco-direct-entry";
import {SesameExportShipments} from "./sesame-export-shipments";
import {SesameGradeStockView} from "./sesame-grade-stock";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { ENTITY_NAMES, sesameBookQty, type SesameEntity } from "@/lib/sesame-entity";
import { useExecutionCommodityDesk } from "./commodity-desk-provider";
import { InventoryStatistics } from "./inventory-statistics";
import { useTeam } from "@/lib/use-team";
import { canActOnDepartment } from "@/lib/departments";

const qty = (value: number) => formatDisplayNumber(value, "en-PK", { maximumFractionDigits: 3 });
const cell = "border-b border-border px-4 py-3 text-left";
const input = "kastros-input w-full";
function useBook(commodityCode?: string) {
  return trpc.sesameExecution.book.useQuery(commodityCode ? { commodityCode } : undefined, { refetchInterval: 30_000 });
}

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
  if (isLoading) return <p>Loading {commodityCode} positions…</p>;
  if (error) return <p role="alert">{error.message}</p>;
  return <section className="kastros-card p-5 space-y-4"><h2 className="text-xl font-semibold">{commodityCode} positions — Pakistan and Dubai FZCO</h2>
    <p className="text-sm text-muted-foreground">{commodityCode === "PKE" ? "Dubai holds no physical stock. Triparty receipts reduce its linked open purchases and sales; Pakistan holds the received inventory. Payments remain separate." : "Pakistan holds physical inventory. Dubai FZCO is a book of open purchases and sales: a sale closes when the buyer pays FZCO; a purchase closes when FZCO pays Kastros Pakistan or the supplier."}</p>
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className={cell}>Position (MT)</th>{data?.positions.map(p => <th className={cell} key={p.entity}>{ENTITY_NAMES[p.entity]}</th>)}</tr></thead><tbody>
      {([['Physical inventory (Pakistan)','ownedMt'],['Open purchases','openBuyMt'],['Open sales','openSellMt'],['Net position','netPositionMt']] as const).map(([label,key]) => <tr key={key}><td className={cell}>{label}</td>{data?.positions.map(p => <td key={p.entity} className={cell}>{key==='ownedMt'&&p.entity==='FZCO'?'—':qty(p[key])}{key==='netPositionMt'&&p.entity==='FZCO'?(p[key]>0?' Long':p[key]<0?' Short':' Balanced'):''}</td>)}</tr>)}
      {([['Entry rate (PKR / maund)','entryRatePkrPerMaund'],['Market rate (PKR / maund)','marketRatePkrPerMaund'],['In / out (PKR / maund)','inOutPkrPerMaund'],['In / out value (PKR)','inOutValuePkr'],['In / out value (USD)','inOutValueUsd']] as const).map(([label,key]) => <tr key={key}><td className={cell}>{label}</td>{data?.positions.map(p => <td key={p.entity} className={cell}>{p[key] == null ? "—" : qty(p[key])}</td>)}</tr>)}
    </tbody></table></div>
    <p className="text-xs text-muted-foreground">Pakistan net position = physical inventory + open purchases − open sales. FZCO net position = open purchases − open sales; a negative balance is Short and a positive balance is Long.</p>
    {canEdit && <form className="flex flex-wrap gap-3 items-end" onSubmit={e => { e.preventDefault(); save.mutate({ commodityCode, season: "SUMMER", fxRate: Number(fx), ...(rate ? { marketRatePkrPerMaund: Number(rate) } : {}) }); }}>
      <label className="text-sm">Shared USD / PKR rate<input aria-label="Shared USD / PKR rate" className={input} type="number" step="0.01" min="0.01" required value={fx} placeholder={String(market?.find(m => m.commodityCode === commodityCode)?.fxRate ?? "")} onChange={e => setFx(e.target.value)} /></label>
      <label className="text-sm">Shared fallback market rate (PKR / maund)<input className={input} type="number" step="0.01" min="0.01" value={rate} onChange={e => setRate(e.target.value)} /></label>
      <button className="kastros-btn-primary" disabled={save.isPending}>Save rate</button>
      {save.error && <p role="alert">{save.error.message}</p>}{save.isSuccess && <p role="status">Rate saved. Locked contracts retain their saved rate.</p>}
    </form>}
    <p className="text-xs text-muted-foreground">Pakistan Daily Prices take precedence over the fallback market rate. FZCO entry cost is the weighted cost of open purchases; Pakistan uses its receipt-based purchase cost.</p>
  </section>;
}

export function SesameInventory() {
  const { active, entity } = useExecutionCommodityDesk();
  if (entity === "FZCO") return <SesameInventoryView commodityCode={active.code} entity="FZCO" />;
  return (
    <InventoryStatistics commodityCode={active.code}>
      <SesamePakistanInventoryExtras commodityCode={active.code} />
    </InventoryStatistics>
  );
}

export function SesamePakistanInventoryExtras({
  commodityCode,
  onSelectEntity,
}: {
  commodityCode: string;
  onSelectEntity?: (entity: SesameEntity) => void;
}) {
  const { data, isLoading, error } = useBook(commodityCode);
  const p = data?.positions.find((row) => row.entity === "PAK");
  return (
    <div className="space-y-5">
      {onSelectEntity && (
        <fieldset>
          <legend className="mb-2 text-xs text-muted-foreground">Trading entity</legend>
          <div className="grid max-w-xs grid-cols-2 gap-1 rounded-lg border border-border p-1">
            {(["PAK", "FZCO"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={value === "PAK"}
                onClick={() => onSelectEntity(value)}
                className={`rounded-md px-3 py-2 text-xs ${value === "PAK" ? "bg-accent-secondary text-white" : "text-muted-foreground"}`}
              >
                {value === "PAK" ? "Pakistan" : ENTITY_NAMES[value]}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <section>
        <h2 className="text-sm font-semibold text-foreground">Pakistan {commodityCode} book</h2>
      </section>
      {isLoading && <p className="text-sm text-muted-foreground">Loading {commodityCode} book…</p>}
      {error && <p role="alert">{error.message}</p>}
      <div className="grid gap-4 md:grid-cols-4">
        {([
          ["Physical", p?.ownedMt],
          ["Open purchases", p?.openBuyMt],
          ["Open sales", p?.openSellMt],
          ["Free to sell", p?.freeMt],
        ] as [string, number | undefined][]).map(([label, value]) => (
          <section key={label} className="kastros-card p-4">
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className="mt-2 text-2xl font-semibold">{qty(value ?? 0)} MT</div>
          </section>
        ))}
      </div>
      <div className="kastros-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {["Pakistan warehouse", "Physical MT", "Open sale / booked MT", "Free to sell MT"].map((h) => (
                <th key={h} className={cell}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.warehouses.map((w) => (
              <tr key={w.name}>
                <td className={cell}>{w.name}</td>
                <td className={cell}>{qty(w.quantityMt)}</td>
                <td className={cell}>{qty(w.bookedMt)}</td>
                <td className={cell}>{qty(w.freeToSellMt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data?.warehouses.length && <p className="p-5">No physical {commodityCode} receipts yet.</p>}
        {(data?.unassignedBookedMt ?? 0) > 0 && (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            {qty(data!.unassignedBookedMt)} MT of open Pakistan sales is not allocated to a warehouse yet, so it is
            not reserved against any one location.
          </p>
        )}
      </div>
      <SesameGradeStockView commodityCode={commodityCode} />
    </div>
  );
}

export function SesameInventoryView({
  commodityCode,
  entity,
  onSelectEntity,
}: {
  commodityCode: string;
  entity: SesameEntity;
  onSelectEntity?: (entity: SesameEntity) => void;
}) {
  const { data, isLoading, error } = useBook(commodityCode);
  const p = data?.positions.find(p => p.entity === entity);
  if (isLoading) return <p>Loading inventory…</p>;
  if (error) return <p role="alert">{error.message}</p>;
  return <div className="kastros-desk-page space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">{ENTITY_NAMES[entity]} {commodityCode} inventory</h1>
        {entity === "FZCO" && <p className="text-sm text-muted-foreground">{commodityCode === "PKE" ? "Dubai holds no physical stock. Triparty receipts reduce its linked open purchases and sales; Pakistan holds the received inventory. Payments remain separate." : "Open purchases stay until FZCO pays Kastros Pakistan or the supplier. Open sales stay until the buyer pays FZCO. Net is purchases minus sales. Supplier-held goods are shown separately below."}</p>}
      </div>
      {onSelectEntity && <fieldset><legend className="mb-2 text-xs text-muted-foreground">Trading entity</legend><div className="grid grid-cols-2 gap-1 rounded-lg border border-border p-1">{(["PAK", "FZCO"] as const).map(value => <button key={value} type="button" aria-pressed={entity === value} onClick={() => onSelectEntity(value)} className={`rounded-md px-3 py-2 text-xs ${entity === value ? "bg-accent-secondary text-white" : "text-muted-foreground"}`}>{value === "PAK" ? "Pakistan" : ENTITY_NAMES[value]}</button>)}</div></fieldset>}
    </div>
    <div className="grid gap-4 md:grid-cols-4">{((entity==="FZCO"?[['Open purchases',p?.openBuyMt],['Open sales',p?.openSellMt],['Net open position',p?.netPositionMt]]:[['Physical',p?.ownedMt],['Open purchases',p?.openBuyMt],['Open sales',p?.openSellMt],['Free to sell',p?.freeMt]]) as [string,number|undefined][]).map(([label,value]) => <section key={label} className="kastros-card p-4"><div className="text-sm text-muted-foreground">{label}</div><div className="text-2xl font-semibold mt-2">{qty(value ?? 0)} MT</div></section>)}</div>
    {entity === "PAK" && <div className="kastros-card overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Pakistan warehouse','Physical MT','Open sale / booked MT','Free to sell MT'].map(h => <th key={h} className={cell}>{h}</th>)}</tr></thead><tbody>{data?.warehouses.map(w => <tr key={w.name}><td className={cell}>{w.name}</td><td className={cell}>{qty(w.quantityMt)}</td><td className={cell}>{qty(w.bookedMt)}</td><td className={cell}>{qty(w.freeToSellMt)}</td></tr>)}</tbody></table>{!data?.warehouses.length && <p className="p-5">No physical {commodityCode} receipts yet.</p>}{(data?.unassignedBookedMt ?? 0) > 0 && <p className="px-4 py-3 text-sm text-muted-foreground">{qty(data!.unassignedBookedMt)} MT of open Pakistan sales is not allocated to a warehouse yet, so it is not reserved against any one location.</p>}</div>}
    {entity === "PAK" && <SesameGradeStockView commodityCode={commodityCode}/>}
    {entity === "FZCO" && <>{commodityCode !== "PKE" && <FzcoHeldStock commodityCode={commodityCode} />}<FzcoBook commodityCode={commodityCode} /></>}
  </div>;
}

export function FzcoHeldStock({ commodityCode }: { commodityCode: string }) {
 const {data,error,isLoading}=useBook(commodityCode);
 const rows=data?.custody.filter(r=>Math.abs(r.ownedMt)>.000001||r.reservedMt>.000001)??[];
 return <section className="kastros-card p-5 space-y-4"><h2 className="text-xl font-semibold">Stock held by counterparty</h2><p className="text-sm text-muted-foreground">Locked purchases appear against the supplier automatically. Dispatch reduces stock held; payment independently closes the open purchase.</p>
 {isLoading?<p>Loading stock…</p>:error?<p role="alert">{error.message}</p>:<><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Held by','Product type','Stock MT','Reserved MT','Available MT'].map(h=><th key={h} className={cell}>{h}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={`${r.holderId}-${r.grade}`}><td className={cell}>{r.holder}</td><td className={cell}>{r.grade}</td><td className={cell}>{qty(r.ownedMt)}</td><td className={cell}>{qty(r.reservedMt)}</td><td className={cell}>{qty(r.availableMt)}</td></tr>)}</tbody></table></div>{!rows.length&&<p>No supplier-held stock.</p>}</>}
 </section>;
}

export function FzcoBook({ commodityCode }: { commodityCode: string }) {
  const { role } = useTeam();
  const canReview = role === "EXECUTION" || role === "CEO" || role === "ADMIN";
  const { data, error, isLoading } = useBook(commodityCode);
  const rows = data?.trades.filter(t => t.submitted && (t.entity === "FZCO" || t.internalEntity === "FZCO")) ?? [];
  if (isLoading) return <p>Loading FZCO trades…</p>;
  if (error) return <p role="alert">{error.message}</p>;
  return <section className="kastros-card p-5 space-y-4"><h2 className="text-xl font-semibold">FZCO open book</h2>
    <p className="text-sm text-muted-foreground">{commodityCode === "PKE" ? "Dubai holds no physical stock. Triparty receipts reduce its linked open purchases and sales; Pakistan holds the received inventory. Payments remain separate." : "Purchases stay open until FZCO pays Kastros Pakistan or the supplier. Sales stay open until the buyer pays FZCO."}</p>
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Trade','FZCO side','Counterparty','Quantity MT','On book MT','Status','Action'].map(h => <th key={h} className={cell}>{h}</th>)}</tr></thead><tbody>{rows.map(t => {
      const side = t.entity === "FZCO" ? t.direction : t.direction === "BUY" ? "SELL" : "BUY";
      const counterparty = t.internalEntity ? ENTITY_NAMES[t.entity === "FZCO" ? t.internalEntity : t.entity] : t.counterparty;
      const bookMt = sesameBookQty({ quantityMt: t.quantityMt, openMt: t.openMt, receivedMt: t.receivedMt, internal: t.internalEntity != null, closeOnPayment: t.closeOnPayment, contractStatus: t.contractStatus, asEntity: "FZCO" });
      const paid = t.contractStatus === "Close";
      return <tr key={t.tradeRef}><td className={cell}>{t.tradeRef}{t.internalEntity ? <span className="block text-xs text-subtle">{commodityCode === "PKE" && side === "SELL" ? "Internal FZCO → Pakistan" : "Internal Pakistan → FZCO"}</span> : null}</td><td className={cell}>{side === "BUY" ? "Purchase" : "Sale"}</td><td className={cell}>{counterparty}</td><td className={cell}>{qty(t.quantityMt)}</td><td className={cell}>{qty(bookMt)}</td><td className={cell}>{paid ? (t.closeOnPayment ? "Closed (paid)" : "Received") : (t.closeOnPayment ? "Open until paid" : "Awaiting receipt")}</td><td className={cell}>{t.status === "PENDING" && t.entity === "FZCO" && canReview ? <Link href={`/execution/open-trades/${encodeURIComponent(t.tradeRef)}`} className="text-accent-secondary">Review</Link> : "—"}</td></tr>;
    })}</tbody></table></div>{!rows.length && <p className="text-sm text-muted-foreground">No FZCO purchases or sales yet.</p>}
  </section>;
}

export function FzcoOverview() {
  const { selectEntity, active } = useExecutionCommodityDesk();
  return <div className="kastros-desk-page space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Dubai FZCO — {active.name} execution</h1><button className="kastros-btn-secondary" onClick={() => selectEntity("FZCO", "/execution/ledgers")}>View FZCO USD ledger</button></div><SesamePositions /><FzcoBook commodityCode={active.code} /><Link className="kastros-btn-primary inline-block" href="/execution/movements">Manage FZCO truck movements</Link></div>;
}

export function FzcoTrucks() {
  const { role, isHead } = useTeam();
  const canCancel = role != null && canActOnDepartment(role, isHead, "EXECUTION");
  const { data: rows, error } = trpc.execution.saleWorkflowRows.useQuery(undefined, { refetchInterval: 15_000 });
  const utils = trpc.useUtils(); const refresh = () => { void utils.invalidate(); };
  const order = trpc.execution.generateDeliveryOrder.useMutation({ onSuccess: refresh });
  const gate = trpc.execution.generateGatePass.useMutation({ onSuccess: refresh });
  const release = trpc.execution.markSaleReleased.useMutation({ onSuccess: refresh });
  const credit = trpc.execution.requestClearWithoutPayment.useMutation({ onSuccess: refresh });
  const cancel = trpc.sesameExecution.cancelLoad.useMutation({ onSuccess: refresh });
  const issue = order.error ?? gate.error ?? release.error ?? credit.error ?? cancel.error ?? error;
  return <div className="kastros-desk-page space-y-5"><h1 className="text-2xl font-semibold">FZCO trucks</h1><SesameExportShipments mode="movement"/><p><Link href="/execution/movements/fzco-entry" target="_blank" className="underline">Open office truck-entry link</Link></p><p className="text-sm text-muted-foreground">Third-party purchases and sales are independent. Pakistan warehouse movements are shown here for reference and managed in Pakistan Execution.</p>
    <FzcoGateAssignment/><FzcoDirectEntry/>{issue && <p className="text-destructive" role="alert">{issue.message}</p>}
    {canCancel && rows?.some(r => r.saleStage === "AWAITING_BALANCE" && !r.deliveryOrderNo) && <section className="kastros-card p-4"><h2 className="font-semibold">Correct an unapproved load</h2><p className="text-sm text-muted-foreground mb-3">Cancel its reservation before recording the corrected truck.</p>{rows.filter(r => r.saleStage === "AWAITING_BALANCE" && !r.deliveryOrderNo).map(r => <button key={r.truckId} className="kastros-btn-secondary mr-2" disabled={cancel.isPending} onClick={() => { if (window.confirm(`Cancel load ${r.truckNo}?`)) cancel.mutate({ truckId: r.truckId }); }}>Cancel {r.truckNo}</button>)}</section>}
    <div className="kastros-card overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Truck','Trade','Amount PKR','Stage','Action'].map(h => <th className={cell} key={h}>{h}</th>)}</tr></thead><tbody>{rows?.map(r => <tr key={r.truckId}><td className={cell}>{r.truckNo}</td><td className={cell}>{r.tradeRef}</td><td className={cell}>{qty(r.saleExpectedPkr ?? 0)}</td><td className={cell}>{r.saleReleasedAt ? "RELEASED" : r.saleStage}</td><td className={cell}><div className="flex flex-wrap gap-2">{!r.saleReleasedAt && r.canGenerateDo && <button className="kastros-btn-secondary" disabled={order.isPending} onClick={() => order.mutate({ truckId: r.truckId })}>Generate DO</button>}{!r.saleReleasedAt && r.canGenerateGatePass && <button className="kastros-btn-secondary" disabled={gate.isPending} onClick={() => gate.mutate({ truckId: r.truckId })}>Generate gate pass</button>}{!r.saleReleasedAt && r.gateOutSlipNo && <button className="kastros-btn-primary" disabled={release.isPending} onClick={() => release.mutate({ truckId: r.truckId })}>Release truck</button>}{r.saleStage === "AWAITING_BALANCE" && !r.canGenerateDo && <button className="kastros-btn-secondary" disabled={credit.isPending} onClick={() => credit.mutate({ truckId: r.truckId })}>Request credit clearance</button>}{r.deliveryOrderNo && <Link className="text-accent-secondary" href={`/execution/print/delivery-order/${r.truckId}`} target="_blank">Print DO</Link>}{r.gateOutSlipNo && <Link className="text-accent-secondary" href={`/execution/print/gate-out-slip/${r.truckId}`} target="_blank">Print gate pass</Link>}</div></td></tr>)}</tbody></table>{!rows?.length && <p className="p-5">No FZCO trucks yet.</p>}</div>
  </div>;
}

export function SesameInternalLedger({ entity }: { entity?: SesameEntity }) {
  const { active } = useExecutionCommodityDesk();
  const { data } = useBook();
  const internal = data?.trades.filter(t => t.internalEntity && t.submitted) ?? [];
  return <section className="kastros-card p-5 space-y-3"><h2 className="text-lg font-semibold">{active.code === "PKE" ? "Internal FZCO → Pakistan book" : "Internal Pakistan → FZCO book"}</h2><p className="text-sm text-muted-foreground">{active.code === "PKE" ? "Dubai sale and Pakistan purchase share the same trade. Received quantities close on gate-in; payments remain separate." : "Pakistan open sale and FZCO open purchase on the same physical trade. The book drops when FZCO pays Kastros Pakistan."}</p><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Trade','Entity','Side','On book MT','Status'].map(h => <th key={h} className={cell}>{h}</th>)}</tr></thead><tbody>{internal.flatMap(t => (["PAK","FZCO"] as const).filter(e => !entity || e === entity).map(e => {
    const bookMt = sesameBookQty({ quantityMt: t.quantityMt, openMt: t.openMt, receivedMt: t.receivedMt, internal: true, closeOnPayment: t.closeOnPayment, contractStatus: t.contractStatus, asEntity: e });
    return <tr key={`${t.tradeRef}-${e}`}><td className={cell}>{t.tradeRef}</td><td className={cell}>{ENTITY_NAMES[e]}</td><td className={cell}>{e === t.entity ? t.direction : t.direction === "BUY" ? "SELL" : "BUY"}</td><td className={cell}>{qty(bookMt)}</td><td className={cell}>{t.contractStatus === "Close" ? (t.closeOnPayment ? "Closed (paid)" : "Received") : (t.closeOnPayment ? "Open until paid" : "Awaiting receipt")}</td></tr>;
  }))}</tbody></table></div>{!internal.length && <p className="text-sm text-muted-foreground">No internal Pakistan → FZCO trades yet.</p>}</section>;
}
