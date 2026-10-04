"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
export default function InternalGatePage(){return <Suspense fallback={<p>Loading…</p>}><InternalGate /></Suspense>;}
function InternalGate() {
  const inbound = useSearchParams().get("direction")==="in";
  const utils = trpc.useUtils();
  const {data,error} = trpc.execution.stockTransfers.useQuery({});
  const [id,setId] = useState("");
  const [weight,setWeight] = useState("");
  const [success,setSuccess] = useState("");
  const done = ()=>{setSuccess(inbound?"Internal gate in recorded":"Internal gate out recorded");setId("");setWeight("");void utils.invalidate();};
  const dispatch = trpc.execution.dispatchStockTransfer.useMutation({onSuccess:done});
  const receive = trpc.execution.receiveStockTransfer.useMutation({onSuccess:done});
  const selected = data?.find(t=>t.id===id);
  const rows = (data??[]).filter(t=>t.status===(inbound?"IN_TRANSIT":"DRAFT"));
  return <div className="kastros-desk-page max-w-3xl space-y-5"><h1 className="text-2xl font-semibold">Internal gate {inbound?"in":"out"}</h1><p className="text-sm text-subtle">Warehouse shifting and processing trucks only. These movements do not create a purchase, sale, invoice, or external gate entry.</p><Link className="kastros-btn-secondary inline-block" href="/execution/movements?scope=internal">Back to internal trucks</Link>
    <form className="kastros-card p-5 space-y-4" onSubmit={e=>{e.preventDefault();setSuccess("");if(inbound) receive.mutate({id,receivedQtyMt:Number(weight)/1000});else dispatch.mutate({id});}}>
      <label className="block text-sm">Truck<select required className="kastros-select mt-1 w-full" value={id} onChange={e=>{setId(e.target.value);setWeight("");}}><option value="">Select internal truck</option>{rows.map(t=><option key={t.id} value={t.id}>{t.transferRef} · {t.truckNo} · {t.fromWarehouseName ?? t.externalOrigin} → {t.toWarehouseName}</option>)}</select></label>
      {selected && <div className="rounded border border-border p-3 text-sm space-y-1"><p>{selected.commodityName} · {selected.sesameType} · {selected.purpose}</p><p>Dispatch quantity: {(selected.dispatchedQtyMt*1000).toLocaleString()} kg</p><p>Truck: {selected.truckNo} · Bilty: {selected.biltyNo ?? "—"}</p><p>Driver: {selected.driverName ?? "—"} · {selected.driverPhone ?? "—"}</p></div>}
      {inbound && <label className="block text-sm">Received warehouse weight (kg)<input required type="number" min="0.001" step="0.001" className="kastros-input mt-1 w-full" value={weight} onChange={e=>setWeight(e.target.value)} /></label>}
      <button disabled={!id || dispatch.isPending || receive.isPending} className="kastros-btn-primary">Confirm internal gate {inbound?"in":"out"}</button>
      {(error || dispatch.error || receive.error) && <p role="alert" className="text-destructive">{error?.message ?? dispatch.error?.message ?? receive.error?.message}</p>}{success && <p role="status">{success}</p>}
    </form>
  </div>;
}
