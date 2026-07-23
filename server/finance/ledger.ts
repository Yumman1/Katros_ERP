import type { CounterpartySide, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import { num, numOrNull } from "@/server/db/convert";
import {
  AGING_BUCKETS,
  agingBucketFor,
  type AgingBucket,
} from "@/lib/finance-policy";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Every counterparty is ONE record with TWO independent ledger accounts:
 *   SELL — receivables: truck debits (receivable incl. 236G), voucher credits.
 *   BUY  — payables: expected-invoice debits from inbound trucks, payment-out
 *          credits when finance approves a payment.
 * Balances and totals never mix across sides.
 */

/** Sale-truck stages whose receivable has consumed (is covered by) sell-ledger credit. */
export const CREDIT_CONSUMING_STAGES = [
  "PENDING_TRADER",
  "PENDING_FINANCE",
  "PAYMENT_RECEIVED",
  "SETTLED",
] as const;

/** Sale-truck stages considered paid/settled — their debit no longer ages. */
const SETTLED_STAGES = ["PAYMENT_RECEIVED", "SETTLED"] as const;

// ─── Posting ─────────────────────────────────────────────────────────────────

/**
 * Post (or refresh) the truck-driven DEBIT on a counterparty ledger —
 * SELL side: the buyer's receivable (incl. 236G) at outbound assignment;
 * BUY side: the expected invoice payable at inbound assignment.
 * Idempotent on truckId, so re-assignment / recompute updates the amount.
 */
export async function postTruckLedgerDebit(
  input: {
    side: CounterpartySide;
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
        side: input.side,
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
      side: input.side,
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

/** Update ONLY the amount of a truck's ledger debit (dynamic recompute). */
export async function updateTruckLedgerDebitAmount(
  truckId: string,
  amountPkr: number,
  db: Db = prisma,
): Promise<void> {
  await db.counterpartyLedgerEntry.updateMany({
    where: { truckId },
    data: { amountPkr },
  });
}

/** Remove the DEBIT of a truck whose assignment was undone / deleted. */
export async function removeSaleDebitForTruck(truckId: string, db: Db = prisma): Promise<void> {
  await db.counterpartyLedgerEntry.deleteMany({ where: { truckId } });
}

/** Post the SELL-side CREDIT for a finance-approved voucher (idempotent on voucherId). */
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
      side: "SELL",
      entryType: "CREDIT",
      amountPkr: input.amountPkr,
      sourceType: "VOUCHER",
      sourceRef: input.voucherNo,
      voucherId: input.voucherId,
      note: input.note ?? null,
    },
  });
}

/**
 * Post the BUY-side CREDIT when finance approves a payment out to a seller —
 * idempotent on the payment request ref.
 */
export async function postPaymentOutCredit(
  input: {
    requestRef: string;
    counterpartyId: string;
    amountPkr: number;
    tradeRef?: string | null;
    note?: string | null;
  },
  db: Db = prisma,
): Promise<void> {
  const existing = await db.counterpartyLedgerEntry.findFirst({
    where: { side: "BUY", sourceType: "PAYMENT", sourceRef: input.requestRef },
    select: { id: true },
  });
  if (existing) return;
  await db.counterpartyLedgerEntry.create({
    data: {
      counterpartyId: input.counterpartyId,
      side: "BUY",
      entryType: "CREDIT",
      amountPkr: input.amountPkr,
      sourceType: "PAYMENT",
      sourceRef: input.requestRef,
      tradeRef: input.tradeRef ?? null,
      note: input.note ?? null,
    },
  });
}

// ─── Balances & gating ───────────────────────────────────────────────────────

/**
 * Sell-ledger credit not yet consumed by paid/settled (or in-flight legacy)
 * trucks. This is the pool a truck's receivable is checked against before
 * "Confirm payment" succeeds, and before an unpaid truck can be settled.
 */
export async function availableCreditPkr(counterpartyId: string, db: Db = prisma): Promise<number> {
  const [creditAgg, debitEntries] = await Promise.all([
    db.counterpartyLedgerEntry.aggregate({
      where: { counterpartyId, side: "SELL", entryType: "CREDIT" },
      _sum: { amountPkr: true },
    }),
    db.counterpartyLedgerEntry.findMany({
      where: { counterpartyId, side: "SELL", entryType: "DEBIT", truckId: { not: null } },
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
  sourceType: "GATEPASS" | "VOUCHER" | "PAYMENT" | "ADJUSTMENT";
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

/** One ledger ACCOUNT (a counterparty side) — buy and sell never mix. */
export type CounterpartyLedgerView = {
  counterpartyId: string;
  counterpartyName: string;
  counterpartyCode: string;
  /** BUY = payables to them, SELL = receivables from them. */
  side: CounterpartySide;
  /** Display account id, e.g. CP-00101-S / CP-00101-B. */
  ledgerAccountId: string;
  totalDebitPkr: number;
  totalCreditPkr: number;
  /** credit − debit; negative = money outstanding on this account. */
  balancePkr: number;
  /** SELL side only: credit available for confirming/settling trucks. */
  availableCreditPkr: number;
  /** Open (unsettled) debits by aging bucket. */
  aging: Record<AgingBucket, number>;
  entries: LedgerEntryView[];
};

function emptyAging(): Record<AgingBucket, number> {
  return Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0])) as Record<AgingBucket, number>;
}

/**
 * Ledger accounts for every counterparty — a SELL account for each
 * counterparty (voucher targets), plus a BUY account wherever buy-side
 * entries exist. Finance → Counterparty Ledgers, mirrored on execution.
 */
export async function getCounterpartyLedgers(): Promise<CounterpartyLedgerView[]> {
  const [counterparties, entries, trucks] = await Promise.all([
    prisma.counterparty.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
    prisma.counterpartyLedgerEntry.findMany({
      orderBy: { entryDate: "desc" },
      include: { voucher: { select: { voucherNo: true } } },
    }),
    prisma.pendingTruck.findMany({
      where: { saleStage: { not: null } },
      select: { id: true, saleStage: true },
    }),
  ]);

  const truckStage = new Map(trucks.map((t) => [t.id, t.saleStage]));
  const byAccount = new Map<string, LedgerEntryView[]>();
  for (const e of entries) {
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
      saleStage: (e.truckId ? truckStage.get(e.truckId) : null) ?? null,
      note: e.note,
    };
    const key = `${e.counterpartyId}:${e.side}`;
    const list = byAccount.get(key) ?? [];
    list.push(view);
    byAccount.set(key, list);
  }

  const settled = new Set<string>(SETTLED_STAGES);
  const earmarkStages = new Set<string>(CREDIT_CONSUMING_STAGES);

  const accounts: CounterpartyLedgerView[] = [];
  for (const cp of counterparties) {
    for (const side of ["SELL", "BUY"] as const) {
      const list = byAccount.get(`${cp.id}:${side}`) ?? [];
      // SELL accounts always shown (voucher targets); BUY only when active.
      if (side === "BUY" && list.length === 0) continue;
      let totalDebit = 0;
      let totalCredit = 0;
      let earmarked = 0;
      const aging = emptyAging();
      for (const e of list) {
        if (e.entryType === "DEBIT") {
          totalDebit += e.amountPkr;
          const stage = e.saleStage;
          if (side === "SELL" && stage && earmarkStages.has(stage)) earmarked += e.amountPkr;
          // Paid / settled sell receivables stop aging; everything else ages
          // by its due date.
          const stopped = side === "SELL" && stage != null && settled.has(stage);
          if (!stopped && e.agingBucket) aging[e.agingBucket] += e.amountPkr;
        } else {
          totalCredit += e.amountPkr;
        }
      }
      accounts.push({
        counterpartyId: cp.id,
        counterpartyName: cp.name,
        counterpartyCode: cp.code,
        side,
        ledgerAccountId: `${cp.code}-${side === "SELL" ? "S" : "B"}`,
        totalDebitPkr: Math.round(totalDebit * 100) / 100,
        totalCreditPkr: Math.round(totalCredit * 100) / 100,
        balancePkr: Math.round((totalCredit - totalDebit) * 100) / 100,
        availableCreditPkr:
          side === "SELL" ? Math.round((totalCredit - earmarked) * 100) / 100 : 0,
        aging,
        entries: list,
      });
    }
  }
  return accounts;
}

// ─── Overdue alerts (all dashboards) ─────────────────────────────────────────

export type OverdueLedgerAlert = {
  side: CounterpartySide;
  counterpartyName: string;
  counterpartyCode: string;
  ledgerAccountId: string;
  sourceRef: string | null;
  tradeRef: string | null;
  amountPkr: number;
  dueDate: Date;
  overdueDays: number;
  agingBucket: AgingBucket;
};

/**
 * Debit entries past their due date that are still unsettled — surfaced as
 * alerts on every portal dashboard.
 */
export async function getOverdueLedgerAlerts(): Promise<OverdueLedgerAlert[]> {
  const now = new Date();
  const entries = await prisma.counterpartyLedgerEntry.findMany({
    where: { entryType: "DEBIT", dueDate: { lt: now } },
    include: { counterparty: { select: { name: true, code: true } } },
    orderBy: { dueDate: "asc" },
  });
  if (entries.length === 0) return [];
  const truckIds = entries.map((e) => e.truckId).filter((id): id is string => Boolean(id));
  const stages = truckIds.length
    ? new Map(
        (
          await prisma.pendingTruck.findMany({
            where: { id: { in: truckIds } },
            select: { id: true, saleStage: true },
          })
        ).map((t) => [t.id, t.saleStage]),
      )
    : new Map<string, string | null>();

  const settled = new Set<string>(SETTLED_STAGES);
  return entries
    .filter((e) => {
      if (e.side !== "SELL" || !e.truckId) return true;
      const stage = stages.get(e.truckId);
      return !(stage && settled.has(stage));
    })
    .map((e) => ({
      side: e.side,
      counterpartyName: e.counterparty.name,
      counterpartyCode: e.counterparty.code,
      ledgerAccountId: `${e.counterparty.code}-${e.side === "SELL" ? "S" : "B"}`,
      sourceRef: e.sourceRef,
      tradeRef: e.tradeRef,
      amountPkr: num(e.amountPkr),
      dueDate: e.dueDate!,
      overdueDays: Math.floor((now.getTime() - e.dueDate!.getTime()) / 86_400_000),
      agingBucket: agingBucketFor(e.dueDate, now),
    }));
}
