import { prisma } from "@/server/db";

/**
 * Rows created by server-side workflows (change-request apply, gatepass REST)
 * need a createdById. When no session actor is available we attribute them to
 * the system admin account.
 */
let cachedId: string | null = null;

export async function getSystemUserId(): Promise<string> {
  if (cachedId) return cachedId;
  const admin =
    (await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } })) ??
    (await prisma.user.findFirst({ select: { id: true } }));
  if (!admin) {
    throw new Error(
      "No users exist — run the database seed (npm run db:seed) before using the app.",
    );
  }
  cachedId = admin.id;
  return cachedId;
}
