import { z } from "zod";
import { prisma } from "@/server/db";
import { num } from "@/server/db/convert";
import { requireTraderCommodity } from "@/server/trader-commodity-access";
import { traderNamesMatch } from "@/lib/trader-identity";
import { getCounterpartyLedgers } from "@/server/finance/ledger";
import { counterpartyNetPositions } from "@/lib/counterparty-net-position";
import { getDeskMarketPrice } from "@/server/market-prices";
import { deskLegsToPkrPerMaund } from "@/lib/desk-mark-price";
import { quantityUnitToKg } from "@/lib/unit-conversion";
import { cornInOut, cornNoteDirection, cornNoteStatus } from "@/lib/reports/corn-counterparty";

export const cornReportInput = z.object({
  commodityId: z.string().min(1), season: z.enum(["SUMMER", "WINTER"]),
  side: z.enum(["BUY", "SELL", "ALL"]).default("SELL"), counterpartyId: z.string().optional(),
  todayRatePkrPerMaund: z.number().finite().positive().optional(),
});
export async function getCornCounterpartyReport(userId: string, traderName: string, input: z.infer<typeof cornReportInput>) {
  const desk = await requireTraderCommodity(userId, input.commodityId);
  if (desk.code.toUpperCase() !== "CORN") throw new Error("Select the Corn desk for this report");
  const [allTrades, ledgers, published, fallback] = await Promise.all([
    prisma.trade.findMany({where:{commodityId:desk.id,season:input.season,...(input.side === "ALL" ? {} : {direction:input.side})},include:{contract:true,counterparty:{select:{id:true,name:true,code:true}}},orderBy:{tradeDate:"desc"}}),
    getCounterpartyLedgers(desk.code),
    getDeskMarketPrice(desk.code,input.season),
    prisma.positionMarketInput.findUnique({where:{commodityCode_season:{commodityCode:desk.code,season:input.season}}}),
  ]);
  const scoped = allTrades.filter(t => traderNamesMatch(t.traderName,traderName));
  const counterparties = [...new Map(scoped.map(t=>[t.counterpartyId,t.counterparty])).values()].sort((a,b)=>a.name.localeCompare(b.name));
  const trades = scoped.filter(t => !input.counterpartyId || t.counterpartyId === input.counterpartyId);
  const refs = new Set(trades.map(t=>t.tradeRef));
  const publishedRate = published ? deskLegsToPkrPerMaund(published.yesterday,published.cnf) : null;
  const todayRate = input.todayRatePkrPerMaund ?? publishedRate ?? (fallback?.marketRatePkrPerMaund == null ? null : num(fallback.marketRatePkrPerMaund));
  const rateSource = input.todayRatePkrPerMaund != null ? "Report override" : publishedRate != null ? "Daily Prices" : todayRate != null ? "Position fallback" : "Missing";
  const balances = counterpartyNetPositions(ledgers);
  const noteEntries = ledgers.flatMap(a=>a.entries.filter(e=>e.noteStatus && e.sourceRef && /^(DN|CN)-/.test(e.sourceRef) && e.tradeRef && refs.has(e.tradeRef)).map(e=>({...e,side:a.side,counterpartyId:a.counterpartyId})));
  const payments = noteEntries.length ? await prisma.voucher.groupBy({by:["counterpartyId","noteRef"],where:{status:"APPROVED",noteRef:{in:noteEntries.map(e=>e.sourceRef!)}},_sum:{amountPkr:true}}) : [];
  const groups = counterparties.filter(cp => !input.counterpartyId || cp.id === input.counterpartyId).map(cp => {
    const details = trades.filter(t => t.counterpartyId===cp.id && !t.directSettled && ["LOCKED","CONFIRMED","EXECUTED"].includes(t.tradeStatus) && t.contract && num(t.contract.openQtyMt)>0 && t.contract.contractStatus === "Open").map(t=>{
      const contract=t.contract!;
      const openMt=quantityUnitToKg(num(contract.openQtyMt),contract.quantityUnit)/1000;
      const lockedRate=contract.currency === "PKR" ? (contract.ratePerMaund == null ? contract.ratePerKg == null ? null : num(contract.ratePerKg)*40 : num(contract.ratePerMaund)) : null;
      return {tradeRef:t.tradeRef,side:t.direction,openMt,lockedRate,todayRate,inOutPkr:cornInOut(openMt,lockedRate,todayRate),status:t.tradeStatus,rateIssue:lockedRate == null ? "Locked PKR rate unavailable" : null};
    });
    const notes = noteEntries.filter(e=>e.counterpartyId===cp.id).map(e=>{
      const paid = num(payments.find(p=>p.counterpartyId===cp.id && p.noteRef===e.sourceRef)?._sum.amountPkr);
      const direction=cornNoteDirection(e.side,e.entryType);
      return {reference:e.sourceRef!,tradeRef:e.tradeRef!,kind:e.sourceRef!.startsWith("DN-")?"Debit note":"Credit note",amountPkr:e.billedPkr,paidPkr:paid,remainingPkr:e.noteStatus==="PAID"?0:Math.max(0,e.billedPkr-paid),direction,status:cornNoteStatus(direction,e.noteStatus==="PAID",paid)};
    });
    const openMt=details.reduce((s,t)=>s+t.openMt,0);
    const balance=balances.find(b=>b.counterpartyId===cp.id);
    return {...cp,trades:details,notes,openMt,inOutPkr:details.some(t=>t.inOutPkr==null)?null:details.reduce((s,t)=>s+t.inOutPkr!,0),
      receivablePkr:balance?.receivablePkr??0,payablePkr:balance?.payablePkr??0,netPkr:balance?.netPkr??0};
  }).filter(g=>g.trades.length||g.notes.length);
  return {generatedAt:new Date().toISOString(),season:input.season,side:input.side,rate:todayRate,rateSource,rateDate:input.todayRatePkrPerMaund!=null?new Date().toISOString():publishedRate!=null?published!.priceDate:fallback?.updatedAt?.toISOString()??null,counterparties,groups};
}
export type CornCounterpartyReport = Awaited<ReturnType<typeof getCornCounterpartyReport>>;
