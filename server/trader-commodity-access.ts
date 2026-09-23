import { TRPCError } from "@trpc/server";
import { prisma } from "@/server/db";

export async function traderCommodityDesks(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, disabled: true } });
  if (!user || user.disabled || user.role !== "TRADER") throw new TRPCError({ code: "FORBIDDEN", message: "An enabled trader account is required" });
  return prisma.commodity.findMany({
    where: { traderAssignment: { traderId: userId } },
    select: { id: true, code: true, name: true }, orderBy: { name: "asc" },
  });
}
export async function requireTraderCommodity(userId: string, commodityId: string) {
  const desks = await traderCommodityDesks(userId);
  const desk = desks.find(c => c.id === commodityId);
  if (!desk) throw new TRPCError({ code: "FORBIDDEN", message: "This commodity is not assigned to you. Ask the CEO to update your commodity assignments." });
  return desk;
}
