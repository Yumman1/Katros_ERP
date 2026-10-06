"use client";
import { trpc } from "@/lib/trpc/client";
import { useExecutionCommodityDesk } from "./commodity-desk-provider";
import { isSesameCommodity, SESAME_TYPES } from "@/lib/sesame";
export function SesameGradeStock() {
  const {active,entity} = useExecutionCommodityDesk();
  const enabled = isSesameCommodity(active.code) && entity !== "FZCO";
  const {data,error} = trpc.sesameExecution.grades.useQuery(undefined,{enabled,refetchInterval:30000});
  if (!enabled) return null;
  return <section className="kastros-card my-4 p-4 space-y-3"><h2 className="font-semibold">Sesame stock by warehouse (MT)</h2>
    <p className="text-sm text-subtle">Raw + Machine Cleaned + Sortex + Impurities = Sesame stock. Unassigned gate receipts also occupy space and are classified when assigned to a trade. Processing reservations remain in physical stock but are unavailable for sale or shifting. Impurities are excluded from positions.</p>
    {error && <p role="alert">{error.message}</p>}<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{["Warehouse",...SESAME_TYPES,"Unassigned","Locked in processing","Sesame stock"].map(h=><th className="p-2 text-left" key={h}>{h}</th>)}</tr></thead><tbody>{data?.map(w=><tr key={w.name} className="border-t border-border"><td className="p-2">{w.name}</td>{SESAME_TYPES.map(g=><td className="p-2" key={g}>{w.grades[g].toLocaleString("en-PK",{maximumFractionDigits:3})}</td>)}<td className="p-2">{w.unclassifiedMt.toFixed(3)}</td><td className="p-2">{w.processingReservedMt.toFixed(3)}</td><td className="p-2 font-semibold">{w.sesameStockMt.toFixed(3)}</td></tr>)}</tbody></table></div>
  </section>;
}
