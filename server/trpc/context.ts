import { prisma } from "@/server/db";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";

export async function createTRPCContext(options?: { req?: Request }) {
  const session = await getServerSession(authOptions);
  const executionCommodityCode = options?.req?.headers.get("x-execution-commodity")?.trim() || undefined;
  return { session, prisma, executionCommodityCode } as { session: typeof session; prisma: typeof prisma; executionCommodityCode?: string };
}

export type Context = Awaited<ReturnType<typeof createTRPCContext>>;
