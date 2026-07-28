import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Atomically increment and return a named business-reference counter.
 * Implemented as a single INSERT … ON CONFLICT … RETURNING statement, so two
 * concurrent users can never receive the same number — Postgres serializes
 * the row update.
 */
export async function nextRef(name: string, db: Db = prisma): Promise<number> {
  const rows = await db.$queryRaw<Array<{ value: bigint }>>`
    INSERT INTO "RefCounter" ("name", "value")
    VALUES (${name}, 1)
    ON CONFLICT ("name") DO UPDATE SET "value" = "RefCounter"."value" + 1
    RETURNING "value"
  `;
  return Number(rows[0]!.value);
}

/** Raise a counter to at least `minimum` (used when seeding legacy refs). */
export async function bumpRefTo(name: string, minimum: number, db: Db = prisma) {
  await db.$queryRaw`
    INSERT INTO "RefCounter" ("name", "value")
    VALUES (${name}, ${minimum})
    ON CONFLICT ("name") DO UPDATE
    SET "value" = GREATEST("RefCounter"."value", ${minimum})
  `;
}

export const COUNTER = {
  TRADE: "trade",
  INBOUND: "inbound",
  PAYMENT: "payment",
  TRUCK_INBOUND: "gatepass-inbound",
  TRUCK_OUTBOUND: "gatepass-outbound",
  CHANGE_REQUEST: "change-request",
  COUNTERPARTY: "counterparty",
  WAREHOUSE: "warehouse",
  VOUCHER: "voucher",
  SETTLEMENT_INVOICE: "settlement-invoice",
  GATE_OUT_SLIP: "gate-out-slip",
  DELIVERY_ORDER: "delivery-order",
  CANCELLATION_NOTE: "cancellation-note",
} as const;
