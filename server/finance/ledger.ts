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
export const CREDIT_CONSUMING_STAGES = ["PAYMENT_RECEIVED", "SETTLED"] as const;

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

/**
 * Post the CREDIT for a finance-approved voucher (idempotent on voucherId) on
 * the voucher's own side — SELL for a sale, BUY for a purchase settlement.
 */
export async function postCreditForVoucher(
  input: {
    voucherId: string;
    voucherNo: string;
    counterpartyId: string;
    amountPkr: number;
    /** Ledger account to credit; defaults to the sell account. */
    side?: CounterpartySide;
    /** Trade the payment is against; null = direct advance. */
    tradeRef?: string | null;
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
      side: input.side ?? "SELL",
      entryType: "CREDIT",
      amountPkr: input.amountPkr,
      sourceType: "VOUCHER",
      sourceRef: input.voucherNo,
      voucherId: input.voucherId,
      tradeRef: input.tradeRef ?? null,
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

/** Trade funding class from its payment terms. */
export function tradeTermsKind(paymentType: string): "CREDIT" | "ADVANCE" {
  return paymentType === "CREDIT" || paymentType === "CREDIT_30" ? "CREDIT" : "ADVANCE";
}

type SellFundingState = {
  /** Voucher credits linked to a specific sell trade. */
  creditsByTrade: Map<string, number>;
  /** Voucher credits with no trade link — direct advances (any-trade pool). */
  directCredits: number;
  /** Consuming-stage truck receivables per trade. */
  consumedByTrade: Map<string, number>;
  /** Payment-terms kind per trade with consumption or credits. */
  termsByTrade: Map<string, "CREDIT" | "ADVANCE">;
};

/**
 * One-shot funding picture of a buyer's sell ledger, attributing voucher
 * credits to their trades. Trade-linked credits fund only their trade;
 * direct advances cover any trade's overflow. Credit-terms trades don't
 * consume cash — their trucks ride on the trade's credit line instead.
 */
export async function getSellFundingState(
  counterpartyId: string,
  db: Db = prisma,
): Promise<SellFundingState> {
  const [credits, debits, settlementDebits] = await Promise.all([
    db.counterpartyLedgerEntry.findMany({
      where: { counterpartyId, side: "SELL", entryType: "CREDIT" },
      select: { amountPkr: true, tradeRef: true },
    }),
    db.counterpartyLedgerEntry.findMany({
      where: { counterpartyId, side: "SELL", entryType: "DEBIT", truckId: { not: null } },
      select: { truckId: true, tradeRef: true, amountPkr: true },
    }),
    // Settled trades have no truck — their receivable is the settlement
    // invoice, and it always consumes the credit collected against it.
    db.counterpartyLedgerEntry.findMany({
      where: { counterpartyId, side: "SELL", entryType: "DEBIT", invoiceId: { not: null } },
      select: { tradeRef: true, amountPkr: true },
    }),
  ]);

  const creditsByTrade = new Map<string, number>();
  let directCredits = 0;
  for (const c of credits) {
    if (c.tradeRef) {
      creditsByTrade.set(c.tradeRef, (creditsByTrade.get(c.tradeRef) ?? 0) + num(c.amountPkr));
    } else {
      directCredits += num(c.amountPkr);
    }
  }

  const truckIds = debits.map((d) => d.truckId).filter((id): id is string => Boolean(id));
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

  const consumedByTrade = new Map<string, number>();
  for (const d of debits) {
    if (!d.truckId || !consuming.has(d.truckId) || !d.tradeRef) continue;
    consumedByTrade.set(d.tradeRef, (consumedByTrade.get(d.tradeRef) ?? 0) + num(d.amountPkr));
  }
  const settlementRefs = new Set<string>();
  for (const d of settlementDebits) {
    if (!d.tradeRef) continue;
    settlementRefs.add(d.tradeRef);
    consumedByTrade.set(d.tradeRef, (consumedByTrade.get(d.tradeRef) ?? 0) + num(d.amountPkr));
  }

  const refs = [...new Set([...creditsByTrade.keys(), ...consumedByTrade.keys()])];
  const termsByTrade = new Map<string, "CREDIT" | "ADVANCE">();
  if (refs.length) {
    const trades = await db.trade.findMany({
      where: { tradeRef: { in: refs } },
      select: { tradeRef: true, paymentType: true, directSettled: true },
    });
    // A settled trade's receivable is due in full whatever its booked terms —
    // there is no delivery left to run on credit, so it always draws cash.
    for (const t of trades) {
      termsByTrade.set(
        t.tradeRef,
        t.directSettled || settlementRefs.has(t.tradeRef) ? "ADVANCE" : tradeTermsKind(t.paymentType),
      );
    }
  }

  return { creditsByTrade, directCredits, consumedByTrade, termsByTrade };
}

/**
 * Cash available to fund a truck of the given ADVANCE-terms trade: that
 * trade's linked voucher credits minus what its trucks already consumed,
 * plus whatever remains of the direct-advance pool after every other
 * advance trade's overflow is covered.
 */
export function availableForAdvanceTrade(state: SellFundingState, tradeRef: string): number {
  const tradeCredit = state.creditsByTrade.get(tradeRef) ?? 0;
  const tradeConsumed = state.consumedByTrade.get(tradeRef) ?? 0;
  const own = tradeCredit - tradeConsumed;

  // Direct pool minus every OTHER advance trade's overflow beyond its own
  // credits (credit-terms trades never draw cash).
  let directLeft = state.directCredits;
  for (const [ref, consumed] of state.consumedByTrade) {
    if (ref === tradeRef) continue;
    if (state.termsByTrade.get(ref) === "CREDIT") continue;
    const covered = state.creditsByTrade.get(ref) ?? 0;
    directLeft -= Math.max(0, consumed - covered);
  }
  directLeft = Math.max(0, directLeft);

  // Own trade-linked surplus adds to the pool; own overflow drains it.
  return own >= 0 ? own + directLeft : Math.max(0, directLeft + own);
}

export type TruckFundingCheck = {
  ok: boolean;
  kind: "CREDIT" | "ADVANCE";
  availablePkr: number;
  /** For credit trades: the trade's total receivable ceiling. */
  creditCeilingPkr?: number;
  reason?: string;
};

/**
 * Can this truck's receivable be confirmed/settled from the buyer's funding?
 * CREDIT-terms trade: yes while cumulative consuming receivables stay within
 * the trade's total receivable (ledger goes negative within credit terms).
 * ADVANCE-terms trade: yes only when trade-linked + direct voucher credits
 * cover it — otherwise it needs the trader + CEO release path.
 */
export async function canFundTruck(
  input: { counterpartyId: string; tradeRef: string; amountPkr: number },
  db: Db = prisma,
): Promise<TruckFundingCheck> {
  const trade = await db.trade.findUnique({
    where: { tradeRef: input.tradeRef },
    select: {
      paymentType: true,
      quantity: true,
      price: true,
      pricePerCanonicalQty: true,
      counterparty: { select: { taxFilerStatus: true } },
    },
  });
  if (!trade) return { ok: false, kind: "ADVANCE", availablePkr: 0, reason: "Trade not found" };
  const kind = tradeTermsKind(trade.paymentType);
  const state = await getSellFundingState(input.counterpartyId, db);

  if (kind === "CREDIT") {
    const { getFinancePolicy } = await import("./policy");
    const { advanceTaxRateFor } = await import("@/lib/finance-policy");
    const policy = await getFinancePolicy();
    const rate = advanceTaxRateFor(policy, trade.counterparty?.taxFilerStatus);
    const notional =
      num(trade.quantity) *
      (trade.pricePerCanonicalQty != null ? num(trade.pricePerCanonicalQty) : num(trade.price));
    const ceiling = Math.round(notional * (1 + rate / 100) * 100) / 100;
    const consumed = state.consumedByTrade.get(input.tradeRef) ?? 0;
    const ok = consumed + input.amountPkr <= ceiling + 1; // 1 PKR rounding headroom
    return {
      ok,
      kind,
      availablePkr: Math.max(0, ceiling - consumed),
      creditCeilingPkr: ceiling,
      reason: ok
        ? undefined
        : `Credit trade ceiling reached: ${Math.round(consumed).toLocaleString("en-PK")} of ${Math.round(ceiling).toLocaleString("en-PK")} PKR already released against this trade`,
    };
  }

  const available = availableForAdvanceTrade(state, input.tradeRef);
  const ok = available + 0.005 >= input.amountPkr;
  return {
    ok,
    kind,
    availablePkr: available,
    reason: ok
      ? undefined
      : `Insufficient vouchers for this trade: available ${Math.round(available).toLocaleString("en-PK")} PKR < receivable ${Math.round(input.amountPkr).toLocaleString("en-PK")} PKR`,
  };
}

/**
 * Sell-ledger credit not yet consumed by paid/settled (or in-flight legacy)
 * trucks — the aggregate figure shown on ledger pages.
 */
export async function availableCreditPkr(counterpartyId: string, db: Db = prisma): Promise<number> {
  const [creditAgg, debitEntries, settlementAgg] = await Promise.all([
    db.counterpartyLedgerEntry.aggregate({
      where: { counterpartyId, side: "SELL", entryType: "CREDIT" },
      _sum: { amountPkr: true },
    }),
    db.counterpartyLedgerEntry.findMany({
      where: { counterpartyId, side: "SELL", entryType: "DEBIT", truckId: { not: null } },
      select: { truckId: true, amountPkr: true },
    }),
    // Settlement receivables earmark their credit just like a paid truck does —
    // money collected to settle a trade is never free to release another one.
    db.counterpartyLedgerEntry.aggregate({
      where: { counterpartyId, side: "SELL", entryType: "DEBIT", invoiceId: { not: null } },
      _sum: { amountPkr: true },
    }),
  ]);
  const credit = numOrNull(creditAgg._sum.amountPkr) ?? 0;
  const settlementEarmark = numOrNull(settlementAgg._sum.amountPkr) ?? 0;
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
  return credit - earmarked - settlementEarmark;
}

export type LedgerEntryView = {
  id: string;
  entryDate: Date;
  entryType: "DEBIT" | "CREDIT";
  amountPkr: number;
  sourceType: "GATEPASS" | "VOUCHER" | "PAYMENT" | "ADJUSTMENT" | "INVOICE";
  sourceRef: string | null;
  tradeRef: string | null;
  truckId: string | null;
  voucherNo: string | null;
  dueDate: Date | null;
  agingBucket: AgingBucket | null;
  /** For truck debits: current sale workflow stage (null once truck deleted). */
  saleStage: string | null;
  /** For settlement-invoice debits: collection status of that invoice. */
  settlementStatus: string | null;
  /** DEBIT rows: the money behind this entry has moved, so it is not outstanding. */
  settled: boolean;
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
  /** Debits whose money has already moved (buy: receipts PAID; sell: truck paid). */
  settledDebitPkr: number;
  /** Debits still owed — what this account actually has open. */
  outstandingDebitPkr: number;
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

  // Settlement-invoice debits carry their collection status instead of a truck
  // stage — a PAID settlement invoice stops aging exactly like a paid truck.
  const invoiceIds = entries.map((e) => e.invoiceId).filter((id): id is string => Boolean(id));
  const invoiceStatus = invoiceIds.length
    ? new Map(
        (
          await prisma.invoice.findMany({
            where: { id: { in: invoiceIds } },
            select: { id: true, status: true },
          })
        ).map((i) => [i.id, i.status as string]),
      )
    : new Map<string, string>();

  // BUY payables stop aging once finance has paid — i.e. every inbound
  // receipt of the entry's gatepass is PAID.
  const buyGatepassRefs = [
    ...new Set(
      entries
        .filter((e) => e.side === "BUY" && e.entryType === "DEBIT" && e.sourceRef)
        .map((e) => e.sourceRef!),
    ),
  ];
  const paidGatepasses = new Set<string>();
  if (buyGatepassRefs.length) {
    const receipts = await prisma.inboundReceipt.findMany({
      where: { gatepassNo: { in: buyGatepassRefs } },
      select: { gatepassNo: true, status: true },
    });
    const byGp = new Map<string, string[]>();
    for (const r of receipts) {
      if (!r.gatepassNo) continue;
      const list = byGp.get(r.gatepassNo) ?? [];
      list.push(r.status);
      byGp.set(r.gatepassNo, list);
    }
    for (const [gp, statuses] of byGp) {
      if (statuses.length > 0 && statuses.every((s) => s === "PAID")) paidGatepasses.add(gp);
    }
  }

  const settledStages = new Set<string>(SETTLED_STAGES);

  const byAccount = new Map<string, LedgerEntryView[]>();
  for (const e of entries) {
    const stage = (e.truckId ? truckStage.get(e.truckId) : null) ?? null;
    // A debit is settled once the money behind it has moved. On the buy side
    // that is the receipt reaching PAID through the payment process — there is
    // no credit row to wait for; on the sell side it is the truck being paid,
    // or a settlement invoice fully collected.
    const invStatus = (e.invoiceId ? invoiceStatus.get(e.invoiceId) : null) ?? null;
    const settled =
      e.entryType === "DEBIT" &&
      (e.sourceType === "INVOICE"
        ? invStatus === "PAID"
        : e.side === "BUY"
          ? e.sourceRef != null && paidGatepasses.has(e.sourceRef)
          : stage != null && settledStages.has(stage));

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
      saleStage: stage,
      settlementStatus: invStatus,
      settled,
      note: e.note,
    };
    const key = `${e.counterpartyId}:${e.side}`;
    const list = byAccount.get(key) ?? [];
    list.push(view);
    byAccount.set(key, list);
  }

  const earmarkStages = new Set<string>(CREDIT_CONSUMING_STAGES);

  const accounts: CounterpartyLedgerView[] = [];
  for (const cp of counterparties) {
    for (const side of ["SELL", "BUY"] as const) {
      const list = byAccount.get(`${cp.id}:${side}`) ?? [];
      // SELL accounts always shown (voucher targets); BUY only when active.
      if (side === "BUY" && list.length === 0) continue;
      let totalDebit = 0;
      let totalCredit = 0;
      let settledDebit = 0;
      let earmarked = 0;
      const aging = emptyAging();
      for (const e of list) {
        if (e.entryType === "DEBIT") {
          totalDebit += e.amountPkr;
          const stage = e.saleStage;
          if (side === "SELL" && ((stage && earmarkStages.has(stage)) || e.sourceType === "INVOICE")) {
            earmarked += e.amountPkr;
          }
          // Settled debits are done — they neither age nor count as owed.
          if (e.settled) settledDebit += e.amountPkr;
          else if (e.agingBucket) aging[e.agingBucket] += e.amountPkr;
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
        settledDebitPkr: Math.round(settledDebit * 100) / 100,
        outstandingDebitPkr: Math.round((totalDebit - settledDebit) * 100) / 100,
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

  // Paid buy payables stop alerting: every receipt of the gatepass is PAID.
  const buyRefs = [
    ...new Set(entries.filter((e) => e.side === "BUY" && e.sourceRef).map((e) => e.sourceRef!)),
  ];
  const paidGatepasses = new Set<string>();
  if (buyRefs.length) {
    const receipts = await prisma.inboundReceipt.findMany({
      where: { gatepassNo: { in: buyRefs } },
      select: { gatepassNo: true, status: true },
    });
    const byGp = new Map<string, string[]>();
    for (const r of receipts) {
      if (!r.gatepassNo) continue;
      const list = byGp.get(r.gatepassNo) ?? [];
      list.push(r.status);
      byGp.set(r.gatepassNo, list);
    }
    for (const [gp, statuses] of byGp) {
      if (statuses.length > 0 && statuses.every((s) => s === "PAID")) paidGatepasses.add(gp);
    }
  }

  // Settlement receivables that have been collected in full stop alerting.
  const paidInvoices = new Set<string>();
  const invoiceIds = entries.map((e) => e.invoiceId).filter((id): id is string => Boolean(id));
  if (invoiceIds.length) {
    const invs = await prisma.invoice.findMany({
      where: { id: { in: invoiceIds }, status: "PAID" },
      select: { id: true },
    });
    for (const i of invs) paidInvoices.add(i.id);
  }

  const settled = new Set<string>(SETTLED_STAGES);
  return entries
    .filter((e) => {
      if (e.side === "BUY") {
        return !(e.sourceRef && paidGatepasses.has(e.sourceRef));
      }
      if (e.invoiceId) return !paidInvoices.has(e.invoiceId);
      if (!e.truckId) return true;
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
