import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import { num, numOrNull } from "@/server/db/convert";
import {
  AGING_BUCKETS,
  agingBucketFor,
  type AgingBucket,
} from "@/lib/finance-policy";

type Db = PrismaClient | Prisma.TransactionClient;

/** Sale-truck stages whose receivable is covered by (earmarks) ledger credit. */
export const CREDIT_CONSUMING_STAGES = [
  "PENDING_TRADER",
  "PENDING_FINANCE",
  "PAYMENT_RECEIVED",
] as const;

/** Sale-truck stages considered settled — their debit no longer ages. */
const SETTLED_STAGES = ["PAYMENT_RECEIVED"] as const;

// ─── Posting ─────────────────────────────────────────────────────────────────

/**
 * Post (or refresh) the receivable DEBIT for an outbound sale truck —
 * idempotent on truckId, so re-assignment updates the amount instead of
 * duplicating the entry.
 */
export async function postSaleDebitForTruck(
  input: {
    truckId: string;
    gatepassNo: string;
    tradeRef: string;
    counterpartyId: string;
    amountPkr: number;
    dueDate?: Date | null;
    note?: string | null;
  },
  db: Db = prisma,
): Promise<void> {
  const existing = await db.counterpartyLedgerEntry.findUnique({
    where: { truckId: input.truckId },
    select: { id: true },
  });
  if (existing) {
    await db.counterpartyLedgerEntry.update({
      where: { id: existing.id },
      data: {
        counterpartyId: input.counterpartyId,
        amountPkr: input.amountPkr,
        sourceRef: input.gatepassNo,
        tradeRef: input.tradeRef,
        dueDate: input.dueDate ?? null,
        note: input.note ?? null,
      },
    });
    return;
  }
  await db.counterpartyLedgerEntry.create({
    data: {
      counterpartyId: input.counterpartyId,
      entryType: "DEBIT",
      amountPkr: input.amountPkr,
      sourceType: "GATEPASS",
      sourceRef: input.gatepassNo,
      tradeRef: input.tradeRef,
      truckId: input.truckId,
      dueDate: input.dueDate ?? null,
      note: input.note ?? null,
    },
  });
}

/** Remove the DEBIT of a truck whose assignment was undone / deleted. */
export async function removeSaleDebitForTruck(truckId: string, db: Db = prisma): Promise<void> {
  await db.counterpartyLedgerEntry.deleteMany({ where: { truckId } });
}

/** Post the CREDIT for a finance-approved voucher (idempotent on voucherId). */
export async function postCreditForVoucher(
  input: {
    voucherId: string;
    voucherNo: string;
    counterpartyId: string;
    amountPkr: number;
    note?: string | null;
  },
  db: Db = prisma,
): Promise<void> {
  const existing = await db.counterpartyLedgerEntry.findUnique({
    where: { voucherId: input.voucherId },
    select: { id: true },
  });
  if (existing) return;
  await db.counterpartyLedgerEntry.create({
    data: {
      counterpartyId: input.counterpartyId,
      entryType: "CREDIT",
      amountPkr: input.amountPkr,
      sourceType: "VOUCHER",
      sourceRef: input.voucherNo,
      voucherId: input.voucherId,
      note: input.note ?? null,
    },
  });
}

// ─── Balances & gating ───────────────────────────────────────────────────────

/**
 * Approved credit not yet consumed by trucks that were sent onward for
 * approval (or already paid). This is the pool a new truck's receivable is
 * checked against before it may be sent to the trader / finance.
 */
export async function availableCreditPkr(counterpartyId: string, db: Db = prisma): Promise<number> {
  const [creditAgg, debitEntries] = await Promise.all([
    db.counterpartyLedgerEntry.aggregate({
      where: { counterpartyId, entryType: "CREDIT" },
      _sum: { amountPkr: true },
    }),
    db.counterpartyLedgerEntry.findMany({
      where: { counterpartyId, entryType: "DEBIT", truckId: { not: null } },
      select: { truckId: true, amountPkr: true },
    }),
  ]);
  const credit = numOrNull(creditAgg._sum.amountPkr) ?? 0;
  const truckIds = debitEntries.map((e) => e.truckId).filter((id): id is string => Boolean(id));
  const consuming = truckIds.length
    ? new Set(
        (
          await db.pendingTruck.findMany({
            where: { id: { in: truckIds }, saleStage: { in: [...CREDIT_CONSUMING_STAGES] } },
            select: { id: true },
          })
        ).map((t) => t.id),
      )
    : new Set<string>();
  const earmarked = debitEntries.reduce(
    (s, e) => (e.truckId && consuming.has(e.truckId) ? s + num(e.amountPkr) : s),
    0,
  );
  return credit - earmarked;
}

export type LedgerEntryView = {
  id: string;
  entryDate: Date;
  entryType: "DEBIT" | "CREDIT";
  amountPkr: number;
  sourceType: "GATEPASS" | "VOUCHER" | "ADJUSTMENT";
  sourceRef: string | null;
  tradeRef: string | null;
  truckId: string | null;
  voucherNo: string | null;
  dueDate: Date | null;
  agingBucket: AgingBucket | null;
  /** For truck debits: current sale workflow stage (null once truck deleted). */
  saleStage: string | null;
  note: string | null;
};

export type CounterpartyLedgerView = {
  counterpartyId: string;
  counterpartyName: string;
  counterpartyCode: string;
  totalDebitPkr: number;
  totalCreditPkr: number;
  /** credit − debit; negative = the buyer owes us. */
  balancePkr: number;
  /** Credit available for sending new trucks to approval (credit − earmarked). */
  availableCreditPkr: number;
  /** Open (unsettled) receivables by aging bucket. */
  aging: Record<AgingBucket, number>;
  entries: LedgerEntryView[];
};

function emptyAging(): Record<AgingBucket, number> {
  return Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0])) as Record<AgingBucket, number>;
}

/**
 * Full ledgers for every SELL-side counterparty (Finance → Counterparty
 * Ledgers, mirrored on the execution portal). Counterparties without entries
 * still appear so vouchers can be raised against them.
 */
export async function getCounterpartyLedgers(): Promise<CounterpartyLedgerView[]> {
  const [counterparties, entries, trucks] = await Promise.all([
    prisma.counterparty.findMany({
      where: { side: "SELL" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
    prisma.counterpartyLedgerEntry.findMany({
      orderBy: { entryDate: "desc" },
      include: { voucher: { select: { voucherNo: true } } },
    }),
    prisma.pendingTruck.findMany({
      where: { movementType: "OUTBOUND", saleStage: { not: null } },
      select: { id: true, saleStage: true, saleExpectedPkr: true },
    }),
  ]);

  const truckById = new Map(trucks.map((t) => [t.id, t]));
  const byCp = new Map<string, LedgerEntryView[]>();
  for (const e of entries) {
    const truck = e.truckId ? truckById.get(e.truckId) : undefined;
    const view: LedgerEntryView = {
      id: e.id,
      entryDate: e.entryDate,
      entryType: e.entryType,
      amountPkr: num(e.amountPkr),
      sourceType: e.sourceType,
      sourceRef: e.sourceRef,
      tradeRef: e.tradeRef,
      truckId: e.truckId,
      voucherNo: e.voucher?.voucherNo ?? (e.sourceType === "VOUCHER" ? e.sourceRef : null),
      dueDate: e.dueDate,
      agingBucket: e.entryType === "DEBIT" ? agingBucketFor(e.dueDate) : null,
      saleStage: truck?.saleStage ?? null,
      note: e.note,
    };
    const list = byCp.get(e.counterpartyId) ?? [];
    list.push(view);
    byCp.set(e.counterpartyId, list);
  }

  const settled = new Set<string>(SETTLED_STAGES);
  const earmarkStages = new Set<string>(CREDIT_CONSUMING_STAGES);

  return counterparties.map((cp) => {
    const list = byCp.get(cp.id) ?? [];
    let totalDebit = 0;
    let totalCredit = 0;
    let earmarked = 0;
    const aging = emptyAging();
    for (const e of list) {
      if (e.entryType === "DEBIT") {
        totalDebit += e.amountPkr;
        const stage = e.saleStage;
        if (stage && earmarkStages.has(stage)) earmarked += e.amountPkr;
        // Unsettled receivables age; a paid truck's debit is history.
        if (!(stage && settled.has(stage)) && e.agingBucket) {
          aging[e.agingBucket] += e.amountPkr;
        }
      } else {
        totalCredit += e.amountPkr;
      }
    }
    return {
      counterpartyId: cp.id,
      counterpartyName: cp.name,
      counterpartyCode: cp.code,
      totalDebitPkr: Math.round(totalDebit * 100) / 100,
      totalCreditPkr: Math.round(totalCredit * 100) / 100,
      balancePkr: Math.round((totalCredit - totalDebit) * 100) / 100,
      availableCreditPkr: Math.round((totalCredit - earmarked) * 100) / 100,
      aging,
      entries: list,
    };
  });
}
