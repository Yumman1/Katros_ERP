import { prisma } from "@/server/db";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";

export async function createTRPCContext() {
  const session = await getServerSession(authOptions);
  return { session, prisma };
}

export type Context = Awaited<ReturnType<typeof createTRPCContext>>;
