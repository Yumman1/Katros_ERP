import { linkPkeTripartyReceipt } from "@/server/execution/pke-import";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/server/db";
import { tradeEntity, internalEntity, pkeImportSale } from "@/lib/sesame-entity";
import { canApprovePkeLcBypass, emptyPkeImport, PKE_UPLOAD_FIELDS, normalizePkeReferences, PKE_IMPORT_STAGES, type PkeImportPayload } from "@/lib/pke-import";
import { saveGatepassDocuments, getGatepassDocumentUrl } from "@/server/gatepass-documents";
import { randomUUID } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import { z } from "zod";
export const dynamic = "force-dynamic";

async function actor(write = false) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new Error("Sign in to continue");
  const user = await prisma.user.findUnique({where:{id:session.user.id}});
  if (!user || user.disabled || !(write ? ["EXECUTION","CEO"] : ["EXECUTION","CEO","FINANCE"]).includes(user.role)) throw new Error("Access denied");
  return user;
}
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to save import file";
  return NextResponse.json({error:message},{status:message === "Access denied" ? 403 : message === "Sign in to continue" ? 401 : 400});
}
async function purchase(ref: string) {
  const trade = await prisma.trade.findUnique({where:{tradeRef:ref},include:{commodity:true,counterparty:true}});
  if (!trade || trade.commodity.code !== "PKE" || trade.direction !== "BUY" || tradeEntity(trade.tradeParams) !== "FZCO" || internalEntity(trade.tradeParams) || trade.tradeStatus === "CANCELLED") throw new Error("Select an active PKE FZCO purchase from an international supplier");
  return trade;
}
export async function GET(request: Request) {
  try {
    const viewer=await actor();
    const url=new URL(request.url), id=url.searchParams.get("id"), documentId=url.searchParams.get("document");
    if (id && documentId) {
      const row=await prisma.pkeImportFile.findUniqueOrThrow({where:{id}});
      const doc=(row.payload as unknown as PkeImportPayload).documents.find(d=>d.id===documentId);
      if(!doc) throw new Error("Document not found");
      const signed=await getGatepassDocumentUrl(doc.path);
      if(signed) return NextResponse.redirect(signed);
      if(process.env.VERCEL || process.env.SUPABASE_URL) throw new Error("Document download is unavailable; please retry");
      const root=path.resolve(process.cwd(),"data/local"), target=path.resolve(root,doc.path);
      if(!target.startsWith(root+path.sep)) throw new Error("Invalid document path");
      return new Response(new Uint8Array(await readFile(target)),{headers:{"Content-Type":"application/octet-stream","Content-Disposition":`attachment; filename="${doc.name.replace(/[^a-zA-Z0-9._-]/g,"_")}"`,"X-Content-Type-Options":"nosniff"}});
    }
    const trades=await prisma.trade.findMany({where:{commodity:{code:"PKE"},tradeStatus:{not:"CANCELLED"}},include:{counterparty:true,contract:true},orderBy:{tradeDate:"desc"}});
    const sales=trades.filter(t=>pkeImportSale("PKE",t.direction,t.tradeParams));
    const receipts=await prisma.inboundReceipt.findMany({where:{tradeRef:{in:sales.map(t=>t.tradeRef)},status:{not:"DRAFT"},gatepassNo:{not:null},pkeTripartyReceipt:{is:null}},select:{id:true,tradeRef:true,gatepassNo:true,truckNo:true,allocatedQtyMt:true}});
    return NextResponse.json({canApproveBypasses:canApprovePkeLcBypass(viewer),files:await prisma.pkeImportFile.findMany({include:{receipts:{include:{receipt:{select:{gatepassNo:true,truckNo:true}}}}},orderBy:{updatedAt:"desc"}}),
      purchases:trades.filter(t=>t.direction==="BUY"&&tradeEntity(t.tradeParams)==="FZCO"&&!internalEntity(t.tradeParams)).map(t=>({tradeRef:t.tradeRef,supplier:t.counterparty.name,quantity:Number(t.quantity),openQuantity:Number(t.contract?.openQtyMt??t.quantity),currency:t.currency})),
      sales:sales.map(t=>({tradeRef:t.tradeRef,quantity:Number(t.quantity),openQuantity:Number(t.contract?.openQtyMt??t.quantity)})),receipts});
  } catch(error) { return failure(error); }
}
const lc=z.object({id:z.string().uuid(),side:z.enum(["PAK_DUBAI","DUBAI_SUPPLIER"]),reference:z.string().max(200),bank:z.string().max(200),currency:z.enum(["USD","PKR","AED"]),amount:z.string().refine(v=>v===""||(Number.isFinite(Number(v))&&Number(v)>=0),"LC limit must be a nonnegative amount")});
const edit=z.object({id:z.string(),revision:z.number().int().nonnegative(),action:z.enum(["save","advance"]),lcs:z.array(lc).max(100).optional(),references:z.record(z.string(),z.string().max(2000))});
export async function POST(request: Request) {
  try {
    const user=await actor(true), name=user.name??user.email;
    if(request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form=await request.formData(),id=String(form.get("id")??""), field=String(form.get("field")??""), revision=Number(form.get("revision"));
      const row=await prisma.pkeImportFile.findUniqueOrThrow({where:{id}});
      const existingPayload=row.payload as unknown as PkeImportPayload;
      if(!PKE_UPLOAD_FIELDS.includes(field)&&!existingPayload.lcs?.some(l=>`LC:${l.id}`===field))throw new Error("Choose a shipping document, permit or saved LC");
      if(row.revision!==revision) throw new Error("This file changed. Refresh before uploading");
      const file=form.get("file");
      if(!(file instanceof File)||file.size===0||file.size>4*1024*1024) throw new Error("Choose a file up to 4 MB");
      if(!/\.(pdf|png|jpe?g|docx?|xlsx?)$/i.test(file.name)) throw new Error("Use PDF, image, Word or Excel documents");
      if(process.env.VERCEL&&(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)) throw new Error("Document storage is not configured");
      const [stored]=await saveGatepassDocuments([file],`pke-import-${id}-${randomUUID()}`);
      const payload=row.payload as unknown as PkeImportPayload;
      payload.documents.push({id:randomUUID(),field,name:file.name,path:stored,uploadedAt:new Date().toISOString(),uploadedBy:name});
      payload.history.push({at:new Date().toISOString(),actor:name,action:`Uploaded ${field}: ${file.name}`});
      const result=await prisma.pkeImportFile.updateMany({where:{id,revision},data:{payload:JSON.parse(JSON.stringify(payload)),revision:{increment:1}}});
      if(!result.count) throw new Error("This file changed during upload. Refresh and retry");
      return NextResponse.json({ok:true});
    }
    const input=await request.json();
    if(input.action==="request-bypass"||input.action==="review-bypass"){
      const data=z.object({id:z.string(),revision:z.number().int().nonnegative(),action:z.enum(["request-bypass","review-bypass"]),lcId:z.string().optional(),requirements:z.string().trim().min(1).max(2000).optional(),reason:z.string().trim().min(1).max(2000).optional(),requestId:z.string().optional(),decision:z.enum(["APPROVED","REJECTED"]).optional(),reviewNote:z.string().trim().max(2000).optional()}).parse(input);
      const row=await prisma.pkeImportFile.findUniqueOrThrow({where:{id:data.id}});
      if(row.revision!==data.revision)throw new Error("This file changed. Refresh before continuing");
      const payload=row.payload as unknown as PkeImportPayload;
      payload.bypasses??=[];
      if(data.action==="request-bypass"){
        const selected=payload.lcs?.find(l=>l.id===data.lcId);
        if(!selected||!selected.reference.trim()||!data.requirements||!data.reason)throw new Error("Select a saved LC with a reference and describe the unmet requirements and reason");
        if(payload.bypasses.some(b=>b.lcId===selected.id&&b.status==="PENDING"))throw new Error("This LC already has a pending bypass request");
        payload.bypasses.push({id:randomUUID(),lcId:selected.id,lcSnapshot:selected,requirements:data.requirements,reason:data.reason,status:"PENDING",requestedById:user.id,requestedBy:name,requestedAt:new Date().toISOString()});
        payload.history.push({at:new Date().toISOString(),actor:name,action:`Requested document bypass for LC ${selected.reference}: ${data.requirements} · ${data.reason}`});
      }else{
        if(!canApprovePkeLcBypass(user))throw new Error("Only the execution head can approve or reject LC document bypasses");
        const bypass=payload.bypasses.find(b=>b.id===data.requestId);
        if(!bypass||bypass.status!=="PENDING"||!data.decision)throw new Error("Select a pending bypass request");
        if(data.decision==="APPROVED"&&JSON.stringify(bypass.lcSnapshot)!==JSON.stringify(payload.lcs?.find(l=>l.id===bypass.lcId)))throw new Error("LC terms changed. Reject this request and submit a new one");
        Object.assign(bypass,{status:data.decision,reviewedById:user.id,reviewedBy:name,reviewedAt:new Date().toISOString(),reviewNote:data.reviewNote??""});
        payload.history.push({at:new Date().toISOString(),actor:name,action:`${data.decision} document bypass for LC ${bypass.lcSnapshot.reference} · ${data.reviewNote??""}`});
      }
      const changed=await prisma.pkeImportFile.updateMany({where:{id:data.id,revision:data.revision},data:{payload:JSON.parse(JSON.stringify(payload)),revision:{increment:1}}});
      if(!changed.count)throw new Error("This file changed. Refresh and retry");
      return NextResponse.json({ok:true});
    }
    if(input.action==="receipt")return NextResponse.json(await linkPkeTripartyReceipt(z.object({id:z.string(),revision:z.number().int().nonnegative(),receiptId:z.string(),saleTradeRef:z.string()}).parse(input),name));
    if(input.action==="create") {
      const data=z.object({tradeRef:z.string().min(1),title:z.string().trim().min(1).max(160)}).parse(input);
      await purchase(data.tradeRef);
      return NextResponse.json(await prisma.pkeImportFile.create({data:{purchaseTradeRef:data.tradeRef,title:data.title,createdBy:name,payload:JSON.parse(JSON.stringify(emptyPkeImport()))}}));
    }
    const data=edit.parse(input), row=await prisma.pkeImportFile.findUniqueOrThrow({where:{id:data.id}});

    const payload=row.payload as unknown as PkeImportPayload;
    const saleRef=data.references["Dubai sale trade reference"];
    if(saleRef){
      const sale=await prisma.trade.findUnique({where:{tradeRef:saleRef},include:{commodity:true}});
      if(!sale||!pkeImportSale(sale.commodity.code,sale.direction,sale.tradeParams)||["CANCELLED","REJECTED"].includes(sale.tradeStatus))throw new Error("Choose a PKE Dubai sale to Pakistan");
    }
    if(payload.references["Dubai sale trade reference"]!==saleRef && await prisma.pkeTripartyReceipt.count({where:{importFileId:row.id}}))throw new Error("Cannot change the sale after linking a triparty receipt");
    if(data.lcs){
      for(const request of payload.bypasses??[])if(!data.lcs.some(l=>l.id===request.lcId))throw new Error("Cannot remove an LC with document-bypass history");
      if(new Set(data.lcs.map(l=>l.id)).size!==data.lcs.length)throw new Error("Duplicate LC entry");
      for(const old of payload.lcs??[])if(!data.lcs.some(l=>l.id===old.id)&&payload.documents.some(d=>d.field===`LC:${old.id}`))throw new Error("An LC with uploaded documents cannot be removed");
      payload.lcs=data.lcs;
    }
    payload.references=normalizePkeReferences(data.references);
    const stage=data.action==="advance"?Math.min(row.stage+1,PKE_IMPORT_STAGES.length):Math.min(row.stage,PKE_IMPORT_STAGES.length);
    payload.history.push({at:new Date().toISOString(),actor:name,action:data.action==="advance"?`Advanced to ${PKE_IMPORT_STAGES[stage]?.title??"Completed"} (testing: document checks optional)`:"Updated references"});
    const result=await prisma.pkeImportFile.updateMany({where:{id:data.id,revision:data.revision},data:{stage,payload:JSON.parse(JSON.stringify(payload)),revision:{increment:1}}});
    if(!result.count) throw new Error("This file changed. Refresh before saving");
    return NextResponse.json({ok:true});
  } catch(error) { return failure(error); }
}
