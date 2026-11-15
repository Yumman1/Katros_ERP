import { executionScope } from "@/lib/execution-access";
import { prisma } from "@/server/db";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";

export async function createTRPCContext(options?: { req?: Request }) {
  const session = await getServerSession(authOptions);
  const dbUser = session?.user?.id ? await prisma.user.findUnique({where:{id:session.user.id}}) : null;
  if (session && dbUser) { session.user.executionEntity = dbUser.executionEntity; session.user.isHead = dbUser.isHead; session.user.role = dbUser.role; }
  if (session?.user.id && !dbUser) throw new Error("Account not found");
  if (dbUser?.disabled) throw new Error("Account disabled");
  const {executionEntity,executionCommodityCode}=executionScope(session?.user ?? {role:"READ_ONLY"},options?.req?.headers ?? new Headers());
  return { session, prisma, executionCommodityCode, executionEntity } as { session: typeof session; prisma: typeof prisma; executionCommodityCode?: string; executionEntity?: "PAK" | "FZCO" };
}

export type Context = Awaited<ReturnType<typeof createTRPCContext>>;
