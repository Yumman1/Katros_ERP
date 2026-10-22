"use client";
import { formatDisplayNumber, formatDisplayFixed } from "@/lib/formatters/numbers";
import { trpc } from "@/lib/trpc/client";
import { useExecutionCommodityDesk } from "./commodity-desk-provider";
import { isSesameCommodity, SESAME_TYPES } from "@/lib/sesame";
const qty = (value: number) => formatDisplayNumber(value, "en-PK", { maximumFractionDigits: 3 });
export function SesameGradeStock() {
  const {active,entity} = useExecutionCommodityDesk();
  const enabled = isSesameCommodity(active.code) && entity !== "FZCO";
  return enabled ? <SesameGradeStockView commodityCode={active.code}/> : null;
}
export function SesameGradeStockView({commodityCode}: {commodityCode:string}) {
  const {data,error,isLoading} = trpc.sesameExecution.grades.useQuery({commodityCode},{refetchInterval:30000});
  const book = trpc.sesameExecution.book.useQuery({ commodityCode }, { refetchInterval: 30_000 });
  const booked = (name: string) => book.data?.warehouses.find((w) => w.name === name);
  return <section className="kastros-card my-4 p-4 space-y-3"><h2 className="font-semibold">Sesame stock by warehouse (MT)</h2>
    {isLoading && <p>Loading grade inventory…</p>}
    {error && <p role="alert">{error.message}</p>}<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{["Warehouse",...SESAME_TYPES,"Unassigned","Locked in processing","Sesame stock","Open sale / booked","Free to sell"].map(h=><th className="p-2 text-left" key={h}>{h}</th>)}</tr></thead><tbody>{data?.map(w=>{const row=booked(w.name);return <tr key={w.name} className="border-t border-border"><td className="p-2">{w.name}</td>{SESAME_TYPES.map(g=><td className="p-2" key={g}>{formatDisplayNumber(w.grades[g], "en-PK", {maximumFractionDigits:3})}</td>)}<td className="p-2">{formatDisplayFixed(w.unclassifiedMt, 3)}</td><td className="p-2">{formatDisplayFixed(w.processingReservedMt, 3)}</td><td className="p-2 font-semibold">{formatDisplayFixed(w.sesameStockMt, 3)}</td><td className="p-2">{row ? qty(row.bookedMt) : "—"}</td><td className="p-2">{row ? qty(row.freeToSellMt) : "—"}</td></tr>;})}</tbody></table></div>
  </section>;
}
