"use client";
import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { leaseReminder } from "@/lib/warehouse-lease";

/** Mounted in the execution shell: dismiss for this visit; a fresh login shows it again. */
export function WarehouseLeaseReminder() {
  const { data } = trpc.execution.warehouseLocations.useQuery();
  const [dismissed, setDismissed] = useState("");
  const due = (data ?? []).filter(w=>w.warehouseBasis !== "USE").flatMap(w=> {
    const lease = leaseReminder(w.serviceStartDate,w.hiringPeriodMonths);
    return lease ? [{...w,...lease}] : [];
  });
  const revision = due.map(w=>`${w.id}:${w.start.toISOString()}:${w.end.toISOString()}`).join("|");
  if (!due.length || dismissed === revision) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><section role="dialog" aria-modal="true" aria-labelledby="lease-reminder-title" className="kastros-card max-h-[80vh] w-full max-w-xl overflow-auto p-6 space-y-4">
    <h2 id="lease-reminder-title" className="text-xl font-semibold">Warehouse lease payment reminder</h2>
    <p className="text-sm text-subtle">These leases have reached or passed their halfway point. Please arrange the warehouse lease payment.</p>
    <ul className="space-y-3">{due.map(w=><li key={w.id} className="rounded border border-border p-3"><strong>{w.name}</strong><p className="text-sm">{w.expired ? "Lease ended" : "Lease ends"}: {w.end.toLocaleDateString("en-PK",{timeZone:"Asia/Karachi"})} · {w.hiringPeriodMonths} months</p></li>)}</ul>
    <div className="flex gap-3"><button autoFocus className="kastros-btn-primary" onClick={()=>setDismissed(revision)}>Acknowledge</button><Link className="kastros-btn-secondary" href="/execution/warehouses/manage" onClick={()=>setDismissed(revision)}>Edit lease dates or period</Link></div>
  </section></div>;
}
