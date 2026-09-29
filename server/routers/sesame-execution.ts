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
  cancelLoad: headProcedure("EXECUTION").input(z.object({ truckId: z.string() })).mutation(({ctx,input}) => {
    codeOf(ctx.executionCommodityCode);
    if (ctx.executionEntity !== "FZCO") throw new TRPCError({ code: "BAD_REQUEST", message: "Open the Dubai FZCO desk first" });
    return action(() => cancelFzcoLoad(input.truckId));
  }),
  book: roleProcedure(["EXECUTION", "ADMIN", "FINANCE"]).query(({ctx}) => sesameBook(codeOf(ctx.executionCommodityCode))),
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
