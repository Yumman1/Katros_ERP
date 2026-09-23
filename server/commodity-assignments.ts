import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { commodityCreateInputSchema } from "@/lib/commodity-registration";
import { CORN_TRADER_EMAIL } from "@/lib/trader-identity";
import { isCornCommodity } from "@/lib/trade-constants";
import { prisma } from "@/server/db";
import { addCustomCommodity } from "@/server/trader-master-data";

const SESAME_TRADER_EMAIL = "saad.bashir@kastros.co";

/** Check the database, not just a possibly stale session or the legacy ADMIN gate. */
export async function requireAssignmentCeo(db: Prisma.TransactionClient, actorId: string) {
  const actor = await db.user.findUnique({ where: { id: actorId } });
  if (!actor || actor.disabled || actor.role !== "CEO") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only an enabled CEO can manage trader commodities" });
  }
  return actor;
}

/** Serialize eligibility checks with CEO role/status changes. */
async function lockEligibleTrader(db: Prisma.TransactionClient, traderId: string) {
  await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${traderId} FOR UPDATE`;
  const trader = await db.user.findUnique({ where: { id: traderId } });
  if (!trader || trader.role !== "TRADER" || trader.disabled) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Choose an enabled trader" });
  }
  return trader;
}

/** Called only at registration; CEO transfers/unassignments are never reset on reads. */
export async function initializeCommodityAssignment(
  db: Prisma.TransactionClient,
  commodity: { id: string; code: string; name: string },
  actorId: string,
  requesterId?: string,
) {
  const sesame = ["SES", "SESAME"].includes(commodity.code.trim().toUpperCase()) ||
    /^sesame(?:\s+seeds?)?$/i.test(commodity.name.trim());
  const email = sesame ? SESAME_TRADER_EMAIL : isCornCommodity(commodity.code) ? CORN_TRADER_EMAIL : null;
  const trader = email
    ? await db.user.findFirst({ where: { email: { equals: email, mode: "insensitive" }, role: "TRADER", disabled: false } })
    : requesterId
      ? await db.user.findFirst({ where: { id: requesterId, role: "TRADER", disabled: false } })
      : null;
  if (requesterId && !trader) {
    throw new TRPCError({ code: "BAD_REQUEST", message: email
      ? `Enable the trader account ${email} before approving this commodity`
      : "The requesting user must be an enabled trader before this commodity can be approved" });
  }
  if (trader) await lockEligibleTrader(db, trader.id);
  return db.commodityTraderAssignment.create({
    data: {
      commodityId: commodity.id, traderId: trader?.id ?? null, changedById: actorId,
      source: requesterId ? "COMMODITY_APPROVAL" : "INITIAL_SETUP",
    },
  });
}

/** Approval, registration, unit configuration and ownership succeed or roll back together. */
export async function resolveCommodityRegistration(input: {
  requestId: string; actorId: string; decision: "APPROVED" | "REJECTED"; note?: string;
}) {
  return prisma.$transaction(async (db) => {
    const actor = await requireAssignmentCeo(db, input.actorId);
    const req = await db.changeRequest.findUnique({ where: { id: input.requestId } });
    if (!req || req.department !== "TRADING" || req.entityType !== "COMMODITY" || req.action !== "CREATE") {
      throw new TRPCError({ code: "NOT_FOUND", message: "Commodity registration request not found" });
    }
    if (input.decision === "REJECTED" && !input.note?.trim()) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Add a reason before rejecting" });
    }
    // Conditional UPDATE takes a row lock; a second CEO cannot apply this request twice.
    const claimed = await db.changeRequest.updateMany({
      where: { id: req.id, status: "PENDING_CEO" },
      data: {
        status: input.decision, resolvedByName: actor.name ?? actor.email,
        resolvedAt: new Date(), resolutionNote: input.note?.trim() || null,
        applied: input.decision === "APPROVED",
      },
    });
    if (!claimed.count) throw new TRPCError({ code: "CONFLICT", message: "This request has already been resolved. Refresh the approval queue." });
    if (input.decision === "REJECTED") return;
    const parsed = commodityCreateInputSchema.safeParse(req.payload);
    if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid commodity registration details" });
    const commodity = await addCustomCommodity(parsed.data, { db, createdById: req.requestedById });
    await initializeCommodityAssignment(db, commodity, input.actorId, req.requestedById);
  });
}

export async function assignCommodityTrader(input: {
  commodityId: string; traderId: string | null; expectedVersion: number; actorId: string;
}) {
  try {
    return await prisma.$transaction(async (db) => {
      await requireAssignmentCeo(db, input.actorId);
      const commodity = await db.commodity.findUnique({ where: { id: input.commodityId } });
      if (!commodity) throw new TRPCError({ code: "NOT_FOUND", message: "Commodity not found" });
      if (input.traderId) {
        await lockEligibleTrader(db, input.traderId);
      }
      const data = { traderId: input.traderId, changedById: input.actorId, source: "CEO_ASSIGNMENT" };
      if (input.expectedVersion === 0) {
        await db.commodityTraderAssignment.create({ data: { commodityId: input.commodityId, ...data } });
      } else {
        const updated = await db.commodityTraderAssignment.updateMany({
          where: { commodityId: input.commodityId, version: input.expectedVersion },
          data: { ...data, version: { increment: 1 } },
        });
        if (!updated.count) throw new TRPCError({ code: "CONFLICT", message: "This assignment changed while you were editing. Refresh and try again." });
      }
      return { commodityName: commodity.name, traderId: input.traderId };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new TRPCError({ code: "CONFLICT", message: "This assignment changed while you were editing. Refresh and try again." });
    }
    throw error;
  }
}
