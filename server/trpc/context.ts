import { prisma } from "@/server/db";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";

export async function createTRPCContext(options?: { req?: Request }) {
  const session = await getServerSession(authOptions);
  const executionCommodityCode = options?.req?.headers.get("x-execution-commodity")?.trim() || undefined;
  const executionEntity = options?.req?.headers.get("x-execution-entity") === "FZCO" ? "FZCO" : options?.req?.headers.get("x-execution-entity") === "PAK" ? "PAK" : undefined;
  return { session, prisma, executionCommodityCode, executionEntity } as { session: typeof session; prisma: typeof prisma; executionCommodityCode?: string; executionEntity?: "PAK" | "FZCO" };
}

export type Context = Awaited<ReturnType<typeof createTRPCContext>>;
