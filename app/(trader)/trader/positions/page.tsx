"use client";
import {useState} from "react";
import {useCommodityDesk} from "@/components/trader/commodity-desk-provider";
import {SesamePositionView} from "@/components/execution/sesame-entity-panels";
import {NetPositionPanel} from "@/components/position/net-position-panel";
import {DeskPage,DeskScroll} from "@/components/layout/desk-page";
import {isSesameCommodity} from "@/lib/sesame";
import {trpc} from "@/lib/trpc/client";
export default function TraderPositionsPage(){
 const desk=useCommodityDesk();const [selected,setSelected]=useState("");
 const {data,error}=trpc.trader.positionCommodities.useQuery();
 const code=selected||desk.active?.code||data?.[0]?.code||"";
 const canEdit=desk.desks.some(d=>d.code===code);
 return <DeskPage><DeskScroll className="space-y-5 pb-6"><h1 className="text-2xl font-semibold">Commodity positions</h1><p className="text-sm text-muted-foreground">View positions across all commodities. Rate editing remains available for your assigned desk.</p><label>Commodity<select className="kastros-select block mt-1" value={code} onChange={e=>setSelected(e.target.value)}>{data?.map(c=><option key={c.id} value={c.code}>{c.name}</option>)}</select></label>{error&&<p role="alert">{error.message}</p>}{code&&(isSesameCommodity(code)?<SesamePositionView key={code} commodityCode={code} canEdit={canEdit}/>:<NetPositionPanel key={code} commodityFilter={code} canEdit={canEdit}/>)}</DeskScroll></DeskPage>;
}
