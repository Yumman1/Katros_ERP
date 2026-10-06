import { warehouseProcessing, createProcessingPlan, recordWarehouseProduction, updateProcessingPlan, processingPlanInput, dailyProcessingInput } from "@/server/execution/warehouse-processing";
import { requireTraderCommodity } from "@/server/trader-commodity-access";
import { prisma } from "@/server/db";
import { sesameGrades, recordProcessing } from "@/server/execution/sesame-processing";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, roleProcedure, headProcedure } from "@/server/trpc/trpc";
import { isSesameCommodity } from "@/lib/sesame";
import { cancelFzcoLoad, confirmOwnership, loadFzcoTruck, sesameBook } from "@/server/execution/sesame-ownership";
function codeOf(code?: string) {
  if (!code || !isSesameCommodity(code)) throw new TRPCError({ code: "BAD_REQUEST", message: "Open the Sesame execution desk first" });
  return code;
}
async function action<T>(fn: () => Promise<T>) {
  try { return await fn(); } catch(e) { throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Execution action failed" }); }
}
export const sesameExecutionRouter = router({
  positionSnapshot: roleProcedure(["TRADER","EXECUTION","ADMIN","FINANCE"]).input(z.object({commodityCode:z.string()})).query(async ({ctx,input}) => {
    const code=codeOf(ctx.session.user.role === "TRADER" ? input.commodityCode : ctx.executionCommodityCode);
    const user=await prisma.user.findUnique({where:{id:ctx.session.user.id},select:{disabled:true}});
    if (!user || user.disabled) throw new TRPCError({code:"FORBIDDEN"});
    return {positions:(await sesameBook(code)).positions};
  }),
  warehouseProcessing: roleProcedure(["EXECUTION","FINANCE"]).query(({ctx}) => warehouseProcessing(codeOf(ctx.executionCommodityCode))),
  createProcessingPlan: roleProcedure(["EXECUTION"]).input(processingPlanInput).mutation(({ctx,input}) => {
    if(ctx.executionEntity === "FZCO") throw new TRPCError({code:"FORBIDDEN",message:"Open Pakistan processing"});
    return action(()=>createProcessingPlan(codeOf(ctx.executionCommodityCode),ctx.session.user.name??ctx.session.user.id,input));
  }),
  recordProduction: roleProcedure(["EXECUTION"]).input(dailyProcessingInput).mutation(({ctx,input}) => {
    if(ctx.executionEntity === "FZCO") throw new TRPCError({code:"FORBIDDEN",message:"Open Pakistan processing"});
    return action(()=>recordWarehouseProduction(codeOf(ctx.executionCommodityCode),ctx.session.user.name??ctx.session.user.id,input));
  }),
  updateProcessingPlan: roleProcedure(["EXECUTION"]).input(z.object({id:z.string(),dailyCapacityKg:z.number().finite().positive().multipleOf(.001).optional(),expectedYieldRatio:z.number().finite().min(0).max(1).optional(),cancel:z.boolean().optional()})).mutation(({ctx,input}) => {
    if(ctx.executionEntity === "FZCO") throw new TRPCError({code:"FORBIDDEN",message:"Open Pakistan processing"});
    return action(()=>updateProcessingPlan(codeOf(ctx.executionCommodityCode),input));
  }),
  grades: roleProcedure(["EXECUTION", "TRADER", "FINANCE"]).input(z.object({ commodityCode: z.string().optional() }).optional()).query(({ctx,input}) => sesameGrades(prisma,codeOf(ctx.executionCommodityCode ?? input?.commodityCode))),
  processing: roleProcedure(["EXECUTION", "FINANCE"]).query(async ({ctx}) => {
    const code = codeOf(ctx.executionCommodityCode);
    const rows = await prisma.sesameProcessing.findMany({where:{commodityCode:code},orderBy:{createdAt:"desc"},include:{transfer:{select:{transferRef:true,truckNo:true}}}});
    return rows.map(r=>({...r,inputKg:Number(r.inputKg),outputKg:Number(r.outputKg),impuritiesKg:Number(r.impuritiesKg),yieldRatio:Number(r.yieldRatio)}));
  }),
  recordProcessing: roleProcedure(["EXECUTION"]).input(z.object({transferId:z.string(),toType:z.enum(["Machine Cleaned","Sortex"]),inputKg:z.number().finite().positive(),yieldRatio:z.number().finite().min(0).max(1),requestKey:z.string().uuid()})).mutation(({ctx,input}) => {
    const code = codeOf(ctx.executionCommodityCode);
    if (ctx.executionEntity === "FZCO") throw new TRPCError({code:"BAD_REQUEST",message:"Processing is managed in the Pakistan desk"});
    return action(()=>recordProcessing({...input,code,actor:ctx.session.user.name ?? ctx.session.user.id}));
  }),
  cancelLoad: headProcedure("EXECUTION").input(z.object({ truckId: z.string() })).mutation(({ctx,input}) => {
    codeOf(ctx.executionCommodityCode);
    if (ctx.executionEntity !== "FZCO") throw new TRPCError({ code: "BAD_REQUEST", message: "Open the Dubai FZCO desk first" });
    return action(() => cancelFzcoLoad(input.truckId));
  }),
  book: roleProcedure(["EXECUTION", "ADMIN", "FINANCE", "TRADER"]).input(z.object({commodityCode:z.string().optional()}).optional()).query(async ({ctx,input}) => {
    const code = codeOf(ctx.session.user.role === "TRADER" ? input?.commodityCode : ctx.executionCommodityCode);
    if (ctx.session.user.role === "TRADER") {
      const commodity = await prisma.commodity.findUnique({where:{code}});
      if (!commodity) throw new TRPCError({code:"NOT_FOUND",message:"Commodity not found"});
      await requireTraderCommodity(ctx.session.user.id,commodity.id);
    }
    return sesameBook(code);
  }),
  confirmOwnership: headProcedure("EXECUTION").input(z.object({ tradeRef: z.string(), quantityMt: z.number().finite().positive(), warehouseName: z.string().optional() })).mutation(({ctx,input}) => {
    codeOf(ctx.executionCommodityCode);
    return action(() => confirmOwnership({ ...input, entity: ctx.executionEntity ?? "PAK", actor: ctx.session.user.name ?? ctx.session.user.id }));
  }),
  loadTruck: roleProcedure(["EXECUTION", "ADMIN"]).input(z.object({ tradeRef: z.string(), truckNo: z.string().trim().min(1), weightKg: z.number().finite().positive(), transporterName: z.string().trim().min(1) })).mutation(({ctx,input}) => {
    codeOf(ctx.executionCommodityCode);
    if (ctx.executionEntity !== "FZCO") throw new TRPCError({ code: "BAD_REQUEST", message: "Open the Dubai FZCO desk to load its trucks" });
    return action(() => loadFzcoTruck({ ...input, actor: ctx.session.user.name ?? ctx.session.user.id }));
  }),
});
