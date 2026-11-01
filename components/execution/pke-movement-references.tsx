"use client";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useState} from "react";
import {useExecutionCommodityDesk} from "./commodity-desk-provider";
import {trpc} from "@/lib/trpc/client";
export type PkeMovementData={sales:{tradeRef:string}[];files:{id:string;title:string;purchaseTradeRef:string;revision:number;payload:{references:Record<string,string>};receipts:{receiptId:string;saleTradeRef:string;receipt:{gatepassNo:string}}[]}[];receipts:{id:string;tradeRef:string;gatepassNo:string;truckNo:string;allocatedQtyMt:string}[]};
export function usePkeMovementReferences(enabled:boolean){return useQuery<PkeMovementData>({queryKey:["pke-movement-references"],enabled,queryFn:async()=>{const res=await fetch("/api/pke-imports");const data=await res.json();if(!res.ok)throw new Error(data.error??"Unable to load PKE references");return data;}});}
/** Reconcile receipts allocated before automatic triparty linking was installed. */
export function PkeExistingReceiptReferences(){
 const {active,entity}=useExecutionCommodityDesk();
 const query=usePkeMovementReferences(active.code==="PKE"&&entity==="PAK");
 const cache=useQueryClient(),utils=trpc.useUtils();
 const [receiptId,setReceipt]=useState(""),[fileId,setFile]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 if(active.code!=="PKE"||entity!=="PAK")return null;
 if(query.error)return <p role="alert">{query.error.message}</p>;
 if(!query.data?.receipts.length)return null;
 const receipt=query.data.receipts.find(r=>r.id===receiptId);
 const file=query.data.files.find(f=>f.id===fileId);
 return <section className="exec-panel space-y-3"><h2 className="font-semibold">Existing PKE gate-ins — complete triparty references</h2><p className="text-sm">These receipts were allocated before their supplier purchase was linked. New triparty gate-ins link both trades when assigned below.</p>
 <label className="block text-sm">Dubai sale / Pakistan receipt<select className="kastros-select w-full" value={receiptId} onChange={e=>{setReceipt(e.target.value);setFile("");}}><option value="">Select gate-in</option>{query.data.receipts.map(r=><option key={r.id} value={r.id}>{r.gatepassNo} · {r.truckNo} · Sale {r.tradeRef} · {r.allocatedQtyMt} MT</option>)}</select></label>
 <label className="block text-sm">Dubai supplier purchase<select className="kastros-select w-full" value={fileId} onChange={e=>setFile(e.target.value)}><option value="">Select purchase / import file</option>{query.data.files.filter(f=>!f.payload.references["Dubai sale trade reference"]||f.payload.references["Dubai sale trade reference"]===receipt?.tradeRef).map(f=><option key={f.id} value={f.id}>{f.purchaseTradeRef} · {f.title}</option>)}</select></label>
 <button className="kastros-btn-primary" disabled={busy||!receipt||!file} onClick={async()=>{if(!receipt||!file||!window.confirm("Link these references and close the received Dubai quantity?"))return;setBusy(true);setError("");try{const res=await fetch("/api/pke-imports",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"receipt",id:file.id,revision:file.revision,receiptId:receipt.id,saleTradeRef:receipt.tradeRef})});const result=await res.json();if(!res.ok)throw new Error(result.error);setReceipt("");setFile("");await cache.invalidateQueries();await utils.invalidate();}catch(e){setError(e instanceof Error?e.message:"Unable to link receipt");}finally{setBusy(false);}}}>Confirm triparty references</button>{error&&<p role="alert" className="text-destructive">{error}</p>}</section>;
}
