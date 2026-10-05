import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { dispatchStockTransfer, receiveStockTransfer } from "@/server/execution/stock-transfers";
import { readInternalGateAccess } from "@/server/execution/internal-gate-access";
export const dynamic = "force-dynamic";
const schema = z.object({token:z.string().uuid(),direction:z.enum(["in","out"]),recordedBy:z.string().trim().min(1).max(120),receivedKg:z.number().finite().positive().optional()});
export async function GET(request:Request) {
  const params = new URL(request.url).searchParams;
  const access = params.get("access");
  if (access) {
    const commodityCode = readInternalGateAccess(access);
    if (!commodityCode) return NextResponse.json({error:"This gate link is invalid or expired. Request a new link from execution."},{status:403});
    const rows = await prisma.stockTransfer.findMany({
      where: { commodityCode, status: { in: ["DRAFT", "IN_TRANSIT"] } },
      select: { internalGateToken:true,transferRef:true,status:true,truckNo:true,fromWarehouseName:true,toWarehouseName:true,externalOrigin:true,commodityCode:true,commodityName:true,sesameType:true,purpose:true,dispatchedQtyMt:true,biltyNo:true },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({movements:rows.map(t=>({...t,dispatchedKg:Number(t.dispatchedQtyMt)*1000}))},{headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
  }
  const token = params.get("token");
  if (!z.string().uuid().safeParse(token).success) return NextResponse.json({error:"Invalid internal gate link"},{status:400});
  const t = await prisma.stockTransfer.findUnique({where:{internalGateToken:token!},select:{transferRef:true,status:true,truckNo:true,fromWarehouseName:true,toWarehouseName:true,externalOrigin:true,commodityCode:true,commodityName:true,sesameType:true,purpose:true,dispatchedQtyMt:true,receivedQtyMt:true,biltyNo:true,outGatepassNo:true,inGatepassNo:true}});
  if(!t) return NextResponse.json({error:"Internal movement not found"},{status:404});
  return NextResponse.json({...t,dispatchedKg:Number(t.dispatchedQtyMt)*1000,receivedKg:t.receivedQtyMt==null?null:Number(t.receivedQtyMt)*1000},{headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
}
export async function POST(request:Request) {
  const input = schema.safeParse(await request.json().catch(()=>null));
  if (!input.success) return NextResponse.json({error:input.error.issues[0]?.message ?? "Invalid entry"},{status:400});
  try {
    const t=await prisma.stockTransfer.findUnique({where:{internalGateToken:input.data.token},select:{id:true}});
    if(!t) return NextResponse.json({error:"Internal movement not found"},{status:404});
    const {direction,recordedBy,receivedKg}=input.data;
    if(direction==="in" && receivedKg==null) throw new Error("Enter received warehouse weight");
    const row=direction==="out"?await dispatchStockTransfer(t.id,recordedBy):await receiveStockTransfer(t.id,recordedBy,receivedKg!/1000);
    return NextResponse.json({ok:true,gatepassNo:direction==="out"?row.outGatepassNo:row.inGatepassNo});
  } catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Could not record internal gate movement"},{status:400});}
}
