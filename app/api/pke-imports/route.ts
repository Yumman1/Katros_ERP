import { isDubaiExecution } from "@/lib/execution-access";
import { linkPkeTripartyReceipt } from "@/server/execution/pke-import";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/server/db";
import { tradeEntity, internalEntity, pkeImportSale } from "@/lib/sesame-entity";
import { shipmentStage, canUploadPkeDocument, missingDubaiLc, canApprovePkeLcBypass, emptyPkeImport, PKE_UPLOAD_FIELDS, normalizePkeReferences, PKE_IMPORT_STAGES, type PkeImportPayload } from "@/lib/pke-import";
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
      const download=url.searchParams.get("download")==="1";
      const filename=doc.name.replace(/[^a-zA-Z0-9._-]/g,"_");
      const disposition=`${download?'attachment':'inline'}; filename="${filename}"`;
      if(signed){
        if(!download)return NextResponse.redirect(signed);
        const stored=await fetch(signed);
        if(!stored.ok||!stored.body)throw new Error("Document download is unavailable; please retry");
        return new Response(stored.body,{headers:{"Content-Type":stored.headers.get("Content-Type")||"application/octet-stream","Content-Disposition":disposition,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
      }
      if(process.env.VERCEL || process.env.SUPABASE_URL) throw new Error("Document download is unavailable; please retry");
      const root=path.resolve(process.cwd(),"data/local"), target=path.resolve(root,doc.path);
      if(!target.startsWith(root+path.sep)) throw new Error("Invalid document path");
      return new Response(new Uint8Array(await readFile(target)),{headers:{"Content-Type":({pdf:"application/pdf",png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg"} as Record<string,string>)[path.extname(doc.name).slice(1).toLowerCase()]||"application/octet-stream","Content-Disposition":disposition,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
    }
    const trades=await prisma.trade.findMany({where:{commodity:{code:"PKE"},tradeStatus:{not:"CANCELLED"}},include:{counterparty:true,contract:true},orderBy:{tradeDate:"desc"}});
    const sales=trades.filter(t=>pkeImportSale("PKE",t.direction,t.tradeParams));
    const receipts=await prisma.inboundReceipt.findMany({where:{tradeRef:{in:sales.map(t=>t.tradeRef)},status:{not:"DRAFT"},gatepassNo:{not:null},pkeTripartyReceipt:{is:null}},select:{id:true,tradeRef:true,gatepassNo:true,truckNo:true,allocatedQtyMt:true}});
    return NextResponse.json({executionEntity:isDubaiExecution(viewer)?"FZCO":"PAK",canApproveBypasses:canApprovePkeLcBypass(viewer),files:(await prisma.pkeImportFile.findMany({include:{receipts:{include:{receipt:{select:{gatepassNo:true,truckNo:true}}}}},orderBy:{updatedAt:"desc"}})).map(f=>({...f,stage:missingDubaiLc(f.payload as unknown as PkeImportPayload,trades.find(t=>t.tradeRef===f.purchaseTradeRef)?.paymentType)?Math.min(shipmentStage(f.stage,f.payload as unknown as PkeImportPayload),1):shipmentStage(f.stage,f.payload as unknown as PkeImportPayload)})),
      purchases:trades.filter(t=>t.direction==="BUY"&&tradeEntity(t.tradeParams)==="FZCO"&&!internalEntity(t.tradeParams)).map(t=>({tradeRef:t.tradeRef,supplier:t.counterparty.name,tradeDate:t.tradeDate,pricePerMt:Number(t.pricePerCanonicalQty??t.price),commission:Number(t.commissionAmount??0)*(t.priceCurrency==="USd"?0.01:1),quantity:Number(t.quantity),openQuantity:Number(t.contract?.openQtyMt??t.quantity),currency:t.currency,paymentType:t.paymentType})),
      sales:sales.map(t=>({tradeRef:t.tradeRef,quantity:Number(t.quantity),openQuantity:Number(t.contract?.openQtyMt??t.quantity),paymentType:t.paymentType,currency:t.currency})),receipts});
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
      if(user.role === "EXECUTION" && !canUploadPkeDocument(isDubaiExecution(user)?"FZCO":"PAK",field,existingPayload)) throw new Error("This document belongs to the other execution desk");
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
    let input=await request.json();
    if(isDubaiExecution(user) && !["save-lcs","request-bypass"].includes(input.action)) throw new Error("Dubai can update supplier LCs only");
    if(input.action === "save-lcs") {
      const saved=await prisma.pkeImportFile.findUniqueOrThrow({where:{id:String(input.id)}});
      const prior=saved.payload as unknown as PkeImportPayload;
      input={...input,action:"save",references:prior.references};
    }
    if(input.action==="request-bypass"||input.action==="review-bypass"){
      const data=z.object({id:z.string(),revision:z.number().int().nonnegative(),action:z.enum(["request-bypass","review-bypass"]),lcId:z.string().optional(),documentField:z.string().max(200).optional(),requirements:z.string().trim().min(1).max(2000).optional(),reason:z.string().trim().min(1).max(2000).optional(),requestId:z.string().optional(),decision:z.enum(["APPROVED","REJECTED"]).optional(),reviewNote:z.string().trim().max(2000).optional()}).parse(input);
      const row=await prisma.pkeImportFile.findUniqueOrThrow({where:{id:data.id}});
      if(row.revision!==data.revision)throw new Error("This file changed. Refresh before continuing");
      const payload=row.payload as unknown as PkeImportPayload;
      payload.bypasses??=[];
      if(data.action==="request-bypass"){
        const selected=payload.lcs?.find(l=>l.id===data.lcId);
        if(data.documentField&&!PKE_UPLOAD_FIELDS.includes(data.documentField)&&data.documentField!==`LC:${selected?.id}`)throw new Error("Choose a document from this import file");
        if(data.documentField&&user.role==="EXECUTION"&&!canUploadPkeDocument(isDubaiExecution(user)?"FZCO":"PAK",data.documentField,payload))throw new Error("This document belongs to the other execution desk");
        if(user.role === "EXECUTION" && !data.documentField && selected?.side !== (isDubaiExecution(user)?"DUBAI_SUPPLIER":"PAK_DUBAI"))throw new Error("Choose an LC belonging to your execution desk");
        if(!selected||!selected.reference.trim()||!data.requirements||!data.reason)throw new Error("Select a saved LC with a reference and describe the unmet requirements and reason");
        if(payload.bypasses.some(b=>b.lcId===selected.id&&b.documentField===data.documentField&&b.status==="PENDING"))throw new Error("This LC already has a pending bypass request");
        payload.bypasses.push({id:randomUUID(),lcId:selected.id,lcSnapshot:selected,...(data.documentField?{documentField:data.documentField}:{}),requirements:data.requirements,reason:data.reason,status:"PENDING",requestedById:user.id,requestedBy:name,requestedAt:new Date().toISOString()});
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
    if(input.action==="create"||input.action==="open") {
      const data=z.object({tradeRef:z.string().min(1)}).parse(input);
      await purchase(data.tradeRef);
      const file=await prisma.$transaction(async tx=>{
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pke-import:${data.tradeRef}`}))`;
        if(input.action==="open"){
          const existing=await tx.pkeImportFile.findFirst({where:{purchaseTradeRef:data.tradeRef},orderBy:{createdAt:'desc'}});
          if(existing)return existing;
        }
        const count=await tx.pkeImportFile.count({where:{purchaseTradeRef:data.tradeRef}});
        return tx.pkeImportFile.create({data:{purchaseTradeRef:data.tradeRef,title:`${data.tradeRef} · Shipment ${count+1}`,createdBy:name,payload:JSON.parse(JSON.stringify(emptyPkeImport()))}});
      });
      return NextResponse.json(file);
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
      if(user.role === "EXECUTION") {
        const otherSide=isDubaiExecution(user)?"PAK_DUBAI":"DUBAI_SUPPLIER";
        if(JSON.stringify(data.lcs.filter(l=>l.side===otherSide))!==JSON.stringify((payload.lcs??[]).filter(l=>l.side===otherSide))) throw new Error("Only the owning desk can change this LC");
      }
      for(const request of payload.bypasses??[])if(!data.lcs.some(l=>l.id===request.lcId))throw new Error("Cannot remove an LC with document-bypass history");
      if(new Set(data.lcs.map(l=>l.id)).size!==data.lcs.length)throw new Error("Duplicate LC entry");
      for(const old of payload.lcs??[])if(!data.lcs.some(l=>l.id===old.id)&&payload.documents.some(d=>d.field===`LC:${old.id}`))throw new Error("An LC with uploaded documents cannot be removed");
      payload.lcs=data.lcs;
    }
    payload.references=normalizePkeReferences(data.references);
    const previousStage=shipmentStage(row.stage,payload);payload.workflowVersion=2;
    const stage=data.action==="advance"?Math.min(previousStage+1,PKE_IMPORT_STAGES.length):Math.min(previousStage,PKE_IMPORT_STAGES.length);
    payload.history.push({at:new Date().toISOString(),actor:name,action:data.action==="advance"?`Advanced to ${PKE_IMPORT_STAGES[stage]?.title??"Completed"} (testing: document checks optional)`:"Updated references"});
    const result=await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "PkeImportFile" WHERE id=${data.id} FOR UPDATE`;
      const current=await tx.pkeImportFile.findUniqueOrThrow({where:{id:data.id}});
      if(current.revision!==data.revision)throw new Error("This file changed. Refresh before saving");
      const before=current.payload as unknown as PkeImportPayload;
      if(before.shipmentReviews?.some(q=>q.status==='PENDING'||q.status==='APPROVED'))for(const key of ['Commercial invoice MT','BL quantity MT','Vessel received MT','Dubai sale trade reference','Bill of lading'])if(before.references[key]!==payload.references[key])throw new Error('Resolve the shipment approval before changing its quantities or references');
      const supplier=await tx.trade.findUniqueOrThrow({where:{tradeRef:current.purchaseTradeRef},include:{contract:true}});
      for(const ref of [current.purchaseTradeRef,saleRef].filter(Boolean).sort())await tx.$queryRaw`SELECT id FROM "ExecutionContract" WHERE "tradeRef"=${ref} FOR UPDATE`;
      const related=await tx.pkeImportFile.findMany({where:{purchaseTradeRef:current.purchaseTradeRef,id:{not:current.id}}});
      const blQty=Number(payload.references['BL quantity MT']||0),arrived=Number(payload.references['Vessel received MT']||0);
      const inv=Number(payload.references["Commercial invoice MT"]||0);
      if(!Number.isFinite(inv)||inv<0||(inv>0&&!payload.documents.some(d=>d.field==="Commercial invoice")))throw new Error("Upload the commercial invoice before recording its weight");
      const otherInvoiced=related.reduce((sum,f)=>sum+Number((f.payload as unknown as PkeImportPayload).references["Commercial invoice MT"]||0),0);
      if(inv&&inv+otherInvoiced>Number(supplier.quantity)+Number(supplier.contract?.quantityToleranceMt??0)+.000001)throw new Error("Invoice weight exceeds the remaining purchase quantity and tolerance");
      if(payload.references["Vessel received MT"]==="0"&&!payload.references["Vessel arrival date"])throw new Error("Enter arrival date for zero landing weight");
      if(!Number.isFinite(blQty)||blQty<0||!Number.isFinite(arrived)||arrived<0||arrived>Math.max(inv,blQty)+.000001)throw new Error('Vessel quantity must be positive and no more than the BL quantity');
      if(arrived>0&&(!/^\d{4}-\d{2}-\d{2}$/.test(payload.references['Vessel arrival date']??'')||!Number.isFinite(Date.parse(payload.references['Vessel arrival date']))))throw new Error('Enter a valid vessel arrival date');
      if(arrived>0&&(!payload.references['Vessel name']?.trim()||!payload.references['Arrival port']?.trim()||!payload.references['Vessel arrival date']||!payload.references['Bill of lading']?.trim()||!saleRef))throw new Error('Record vessel, port, arrival date, BL number and linked Dubai sale before receiving stock at port');
      if(supplier.tradeStatus==='CANCELLED')throw new Error('Import cancelled');
      const otherQty=related.reduce((sum,f)=>sum+Number((f.payload as unknown as PkeImportPayload).references['BL quantity MT']||0),0);
      if(data.action==='advance'&&previousStage>=PKE_IMPORT_STAGES.length-1&&otherQty+blQty<Number(supplier.quantity)-Number(supplier.contract?.quantityToleranceMt??0)-.000001&&![current,...related].some(f=>(f.payload as unknown as PkeImportPayload).shipmentReviews?.some(q=>q.kind==='SHORTFALL'&&q.status==='APPROVED'&&Math.abs(q.quantityMt-(Number(supplier.quantity)-otherQty-blQty))<.000001)))throw new Error('Save all BL quantities, then request trader approval of the final shortfall before completing the import');
      if(otherQty+blQty>Number(supplier.quantity)+.000001)throw new Error('Combined BL quantities exceed the supplier purchase contract');
      if(saleRef){
        await tx.$queryRaw`SELECT id FROM "ExecutionContract" WHERE "tradeRef"=${saleRef} FOR UPDATE`;
        const sale=await tx.trade.findUniqueOrThrow({where:{tradeRef:saleRef}});
        const saleFiles=await tx.pkeImportFile.findMany({where:{id:{not:current.id},payload:{path:['references','Dubai sale trade reference'],equals:saleRef}}});
        if(saleFiles.reduce((sum,f)=>sum+Number((f.payload as unknown as PkeImportPayload).references['BL quantity MT']||0),0)+blQty>Number(sale.quantity)+.000001)throw new Error('Combined BL quantities exceed the Dubai sale contract');
      }
      const movementCount=await tx.pkePortMovement.count({where:{importFileId:current.id}})+await tx.trade.count({where:{tradeStatus:{not:'CANCELLED'},tradeParams:{path:['pkePortFileId'],equals:current.id}}});
      const {portLocation}=await import('@/server/execution/pke-port');
      const shifts=await tx.stockTransfer.count({where:{commodityCode:'PKE',fromWarehouseName:portLocation(current.id,before.references['Arrival port']??'',before.references['Vessel name']??''),status:{not:'CANCELLED'}}});
      if(movementCount||shifts)for(const key of ['Commercial invoice MT','Vessel name','Arrival port','Vessel arrival date','Vessel received MT','BL quantity MT','Bill of lading','Dubai sale trade reference'])if(before.references[key]!==payload.references[key])throw new Error('Cannot change vessel or BL quantity references after a port movement');
      const siblings=await tx.pkeImportFile.findMany({where:{id:{not:current.id},OR:[{purchaseTradeRef:current.purchaseTradeRef},...(saleRef?[{payload:{path:['references','Dubai sale trade reference'],equals:saleRef}}]:[])]}});
      for(const lc of payload.lcs??[]){
        if(!lc.reference.trim())continue;
        for(const sibling of siblings){
          const other=sibling.payload as unknown as PkeImportPayload;
          const sameTrade=lc.side==='DUBAI_SUPPLIER'?sibling.purchaseTradeRef===current.purchaseTradeRef:other.references['Dubai sale trade reference']===saleRef;
          if(!sameTrade)continue;
          const existing=other.lcs?.find(l=>l.side===lc.side&&l.reference===lc.reference);
          if(existing&&(existing.currency!==lc.currency||Number(existing.amount)!==Number(lc.amount)||existing.bank!==lc.bank))throw new Error('The same LC across BL files must use the same currency, bank and total limit');
        }
      }
      const allowedSides=new Set<string>();
      if(supplier.paymentType==='LC')allowedSides.add('DUBAI_SUPPLIER');
      if(saleRef&&(await tx.trade.findUniqueOrThrow({where:{tradeRef:saleRef}})).paymentType==='LC')allowedSides.add('PAK_DUBAI');
      for(const lc of payload.lcs??[])if(!allowedSides.has(lc.side)&&JSON.stringify(before.lcs?.find(l=>l.id===lc.id))!==JSON.stringify(lc))throw new Error('Remove LC entries for trades with CAD or other non-LC payment terms');

      if(data.action==='advance' && stage >= PKE_IMPORT_STAGES.length && supplier.paymentType==='LC') {
        if(missingDubaiLc(payload,supplier.paymentType)) throw new Error('Dubai must upload its supplier LC documents before completing this import');
      }
      const payments=await tx.voucher.findMany({where:{status:{not:"REJECTED"},pkePayment:{path:["fileId"],equals:data.id}},select:{pkePayment:true}});
      for(const v of payments){
        const payment=v.pkePayment as {bl:boolean;lcId?:string;side:string};
        if(before.references["Dubai sale trade reference"]!==payload.references["Dubai sale trade reference"])throw new Error("Cannot change the sale linked to a payment voucher");
        if(payment.bl){
          const amountField=payment.side==="PAK_DUBAI"?"Dubai BL invoice amount":"Supplier BL invoice amount";
          if(before.references["Bill of lading"]!==payload.references["Bill of lading"]||before.references[amountField]!==payload.references[amountField])throw new Error("Cannot change a BL reference or invoice value used by a payment voucher");
        }
        if(payment.lcId&&JSON.stringify(before.lcs?.find(l=>l.id===payment.lcId))!==JSON.stringify(payload.lcs?.find(l=>l.id===payment.lcId)))throw new Error("Cannot change an LC used by a payment voucher");
      }
      for(const field of ["Supplier BL invoice amount","Dubai BL invoice amount"]){
        const value=payload.references[field];
        if(value&&(!Number.isFinite(Number(value))||Number(value)<0))throw new Error("BL invoice amounts must be nonnegative numbers");
      }
      const updated=await tx.pkeImportFile.updateMany({where:{id:data.id,revision:data.revision},data:{stage,payload:JSON.parse(JSON.stringify(payload)),revision:{increment:1}}});
      const {settlePkeTrade}=await import('@/server/finance/pke-settlement');
      for(const ref of new Set([current.purchaseTradeRef,saleRef].filter((v):v is string=>!!v)))await settlePkeTrade(tx,ref);
      return updated;
    });
    if(!result.count) throw new Error("This file changed. Refresh before saving");
    return NextResponse.json({ok:true});
  } catch(error) { return failure(error); }
}
