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
 *   BUY  — payables: an inbound truck bills its expected invoice, and the row
 *          debits the account with the money actually released against it, so
 *          a part-paid truck grows its own debit until the invoice is cleared.
 *          Settlement notes bill the same way — a claim until a voucher pays
 *          it — but they settle in one go rather than truck by truck.
 * Balances and totals never mix across sides.
 */

/**
 * Sale-truck stages whose receivable earmarks voucher credit from the buyer's
 * shared pool. In-flight trucks reserve funding once assigned.
 */
export const VOUCHER_EARMARK_STAGES = [
  "AWAITING_BALANCE",
  "DO_PENDING_EXECUTION",
  "DO_PENDING_FINANCE",
  "DO_APPROVED",
  "GATE_PASS_ISSUED",
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
    /** Trade reference for reconciliation; null = no trade tagged. */
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

// ─── Settlement notes (cancellation / short close) ───────────────────────────

/**
 * Ledger direction for a cancellation note.
 *
 * DN (settlement above contract rate) and CN (below) must post on opposite sides
 * depending which account they live on, so balance = credit − debit always
 * moves the right way:
 *   BUY + DN  → CREDIT (seller owes us — reduces net payable)
 *   BUY + CN  → DEBIT  (we owe seller)
 *   SELL + DN → DEBIT  (buyer owes us more)
 *   SELL + CN → CREDIT (we owe buyer)
 */
export function settlementNoteEntryType(
  side: CounterpartySide,
  /** true when settlement price exceeds the contract rate (a DN). */
  isDebitNote: boolean,
): "DEBIT" | "CREDIT" {
  if (side === "BUY") return isDebitNote ? "CREDIT" : "DEBIT";
  return isDebitNote ? "DEBIT" : "CREDIT";
}

/**
 * Ledger filter excluding credits raised by a note voucher. Money that settles
 * a cancellation note is spoken for the moment it lands, so it can neither fund
 * a truck nor inflate the account's free credit.
 */
const NOT_A_NOTE_VOUCHER = {
  OR: [{ voucherId: null }, { voucher: { is: { noteRef: null } } }],
} satisfies Prisma.CounterpartyLedgerEntryWhereInput;

/** When remaining due on a note is at or below this, treat it as fully settled. */
export const NOTE_SETTLE_TOLERANCE_PKR = 500;

export function noteRemainingPkr(billedPkr: number, paidPkr: number): number {
  return Math.max(0, billedPkr - paidPkr);
}

export function noteShouldClose(remainingPkr: number): boolean {
  return remainingPkr <= NOTE_SETTLE_TOLERANCE_PKR;
}

/** Approved voucher total already applied to this note (internal sub-ledger). */
export async function notePaidPkr(
  noteRef: string,
  counterpartyId: string,
  db: Db = prisma,
): Promise<number> {
  const agg = await db.voucher.aggregate({
    where: { noteRef, counterpartyId, status: "APPROVED" },
    _sum: { amountPkr: true },
  });
  return numOrNull(agg._sum.amountPkr) ?? 0;
}

/** Full claim, paid so far, and what's still due on an open note. */
export async function noteBalance(
  noteRef: string,
  counterpartyId: string,
  db: Db = prisma,
): Promise<{ billedPkr: number; paidPkr: number; remainingPkr: number }> {
  const row = await db.counterpartyLedgerEntry.findFirst({
    where: {
      counterpartyId,
      sourceType: "ADJUSTMENT",
      sourceRef: noteRef,
      noteStatus: "UNPAID",
    },
    select: { amountPkr: true },
  });
  const billedPkr = row ? num(row.amountPkr) : 0;
  const paidPkr = await notePaidPkr(noteRef, counterpartyId, db);
  return {
    billedPkr,
    paidPkr,
    remainingPkr: noteRemainingPkr(billedPkr, paidPkr),
  };
}

export type OpenSettlementNote = {
  /** DN-xxxxx (seller owes us) / CN-xxxxx (we owe the seller). */
  noteRef: string;
  side: CounterpartySide;
  /** Remaining due — use for voucher amount cap and dropdown label. */
  amountPkr: number;
  billedPkr: number;
  paidPkr: number;
  remainingPkr: number;
  tradeRef: string | null;
  entryDate: Date;
  note: string | null;
};

/**
 * Cancellation / short-close notes on a counterparty's account still awaiting
 * vouchers — the "against" choices on the voucher form.
 */
export async function listOpenSettlementNotes(
  counterpartyId: string,
  side?: CounterpartySide,
  db: Db = prisma,
): Promise<OpenSettlementNote[]> {
  const rows = await db.counterpartyLedgerEntry.findMany({
    where: {
      counterpartyId,
      ...(side ? { side } : {}),
      sourceType: "ADJUSTMENT",
      noteStatus: "UNPAID",
      sourceRef: { not: null },
    },
    orderBy: { entryDate: "desc" },
    select: { side: true, sourceRef: true, amountPkr: true, tradeRef: true, entryDate: true, note: true },
  });
  const result: OpenSettlementNote[] = [];
  for (const r of rows) {
    const noteRef = r.sourceRef!;
    const billedPkr = num(r.amountPkr);
    const paidPkr = await notePaidPkr(noteRef, counterpartyId, db);
    const remainingPkr = noteRemainingPkr(billedPkr, paidPkr);
    if (noteShouldClose(remainingPkr)) {
      if (paidPkr > 0) {
        const lastVoucher = await db.voucher.findFirst({
          where: { noteRef, counterpartyId, status: "APPROVED" },
          orderBy: { resolvedAt: "desc" },
          select: { voucherNo: true },
        });
        if (lastVoucher) {
          await markSettlementNotePaid(
            { counterpartyId, noteRef, voucherNo: lastVoucher.voucherNo },
            db,
          );
        }
      }
      continue;
    }
    result.push({
      noteRef,
      side: r.side,
      amountPkr: remainingPkr,
      billedPkr,
      paidPkr,
      remainingPkr,
      tradeRef: r.tradeRef,
      entryDate: r.entryDate,
      note: r.note,
    });
  }
  return result;
}

/**
 * Mark a note settled by an approved voucher. Throws if the note is gone or was
 * already paid — a voucher must never approve against a claim that no longer
 * exists.
 */
export async function markSettlementNotePaid(
  input: { counterpartyId: string; noteRef: string; voucherNo: string },
  db: Db = prisma,
): Promise<void> {
  const marked = await db.counterpartyLedgerEntry.updateMany({
    where: {
      counterpartyId: input.counterpartyId,
      sourceType: "ADJUSTMENT",
      sourceRef: input.noteRef,
      noteStatus: "UNPAID",
    },
    data: {
      noteStatus: "PAID",
      noteSettledAt: new Date(),
      noteSettledByVoucherNo: input.voucherNo,
    },
  });
  if (marked.count === 0) {
    throw new Error(`${input.noteRef} is no longer an open note on this counterparty`);
  }
}

// ─── Balances & gating ───────────────────────────────────────────────────────

/** Trade funding class from its payment terms. */
export function tradeTermsKind(paymentType: string): "CREDIT" | "ADVANCE" {
  return paymentType === "CREDIT" || paymentType === "CREDIT_30" ? "CREDIT" : "ADVANCE";
}

export type TruckFundingCheck = {
  ok: boolean;
  kind: "CREDIT" | "ADVANCE";
  availablePkr: number;
  reason?: string;
};

/** Pure shared-pool balance — used by availableCreditPkr and unit tests. */
export function computeSharedPoolAvailablePkr(input: {
  totalCreditPkr: number;
  settlementEarmarkPkr: number;
  truckDebits: { truckId: string; amountPkr: number }[];
  earmarkedTruckIds: Set<string>;
  excludeTruckId?: string;
}): number {
  const earmarked = input.truckDebits.reduce((s, e) => {
    if (!input.earmarkedTruckIds.has(e.truckId)) return s;
    if (input.excludeTruckId && e.truckId === input.excludeTruckId) return s;
    return s + e.amountPkr;
  }, 0);
  return Math.max(0, input.totalCreditPkr - earmarked - input.settlementEarmarkPkr);
}

/**
 * Sell-ledger credit not yet consumed by in-flight trucks or settlement
 * invoices — the buyer's shared voucher pool. Trade ref on credits is for
 * reconciliation only; every approved voucher feeds this one balance.
 */
export async function availableCreditPkr(
  counterpartyId: string,
  db: Db = prisma,
  options?: { excludeTruckId?: string },
): Promise<number> {
  const [creditAgg, debitEntries, settlementAgg] = await Promise.all([
    db.counterpartyLedgerEntry.aggregate({
      // Note vouchers pay a cancellation claim — never free credit.
      where: { counterpartyId, side: "SELL", entryType: "CREDIT", ...NOT_A_NOTE_VOUCHER },
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
            where: { id: { in: truckIds }, saleStage: { in: [...VOUCHER_EARMARK_STAGES] } },
            select: { id: true },
          })
        ).map((t) => t.id),
      )
    : new Set<string>();
  return computeSharedPoolAvailablePkr({
    totalCreditPkr: credit,
    settlementEarmarkPkr: settlementEarmark,
    truckDebits: debitEntries.flatMap((e) =>
      e.truckId ? [{ truckId: e.truckId, amountPkr: num(e.amountPkr) }] : [],
    ),
    earmarkedTruckIds: consuming,
    excludeTruckId: options?.excludeTruckId,
  });
}

/**
 * Can this truck's receivable be confirmed/settled from the buyer's shared
 * voucher pool? Both advance- and credit-terms trades use the same pool check;
 * unfunded release always needs trader + CEO approval regardless of trade type.
 */
export async function canFundTruck(
  input: {
    counterpartyId: string;
    tradeRef: string;
    amountPkr: number;
    /** Omit this truck's receivable when checking whether it can be funded. */
    excludeTruckId?: string;
  },
  db: Db = prisma,
): Promise<TruckFundingCheck> {
  const trade = await db.trade.findUnique({
    where: { tradeRef: input.tradeRef },
    select: { paymentType: true },
  });
  if (!trade) return { ok: false, kind: "ADVANCE", availablePkr: 0, reason: "Trade not found" };
  const kind = tradeTermsKind(trade.paymentType);
  const available = await availableCreditPkr(input.counterpartyId, db, {
    excludeTruckId: input.excludeTruckId,
  });
  const ok = available + 0.005 >= input.amountPkr;
  return {
    ok,
    kind,
    availablePkr: available,
    reason: ok
      ? undefined
      : `Insufficient vouchers for ${input.tradeRef}: ${Math.round(available).toLocaleString("en-PK")} PKR available for this buyer — need ${Math.round(input.amountPkr).toLocaleString("en-PK")} PKR`,
  };
}

export type LedgerEntryView = {
  id: string;
  entryDate: Date;
  entryType: "DEBIT" | "CREDIT";
  /**
   * What this entry has actually posted to its column. Buy debits post the
   * money that has moved, so a part-paid truck grows the same row as finance
   * clears the rest; everywhere else this is the full entry amount.
   */
  amountPkr: number;
  /** What the entry claims in full — amountPkr plus whatever has not moved yet. */
  billedPkr: number;
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
  /** DEBIT rows: the money behind this entry has moved in full. */
  settled: boolean;
  /** DEBIT rows: how much of this entry has actually been paid. */
  paidPkr: number;
  /** Buy debits the trader is holding back — held money never ages. */
  held: boolean;
  /** Cancellation / short-close note rows: is the claim still open? */
  noteStatus: "UNPAID" | "PAID" | null;
  /** Paid notes: the voucher that settled them. */
  noteSettledByVoucherNo: string | null;
  /** Credit rows raised by a note voucher: the note they settled. */
  settlesNoteRef: string | null;
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
  /** Money posted to the debit column — on buy accounts, what has been paid. */
  totalDebitPkr: number;
  totalCreditPkr: number;
  /** What every debit claims in full — gate invoices and open note claims alike. */
  totalBilledPkr: number;
  /** Debits whose money has already moved (buy: receipts PAID; sell: truck paid). */
  settledDebitPkr: number;
  /** Debits still owed — what this account actually has open. */
  outstandingDebitPkr: number;
  /** credit − billed; negative = money outstanding on this account. */
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
      include: { voucher: { select: { voucherNo: true, noteRef: true } } },
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
  /** Money actually paid per gatepass — a partly-released truck counts only its paid part. */
  const paidByGatepass = new Map<string, number>();
  /** Gatepasses the trader is deliberately holding — a hold never ages. */
  const heldGatepasses = new Set<string>();
  if (buyGatepassRefs.length) {
    const [receipts, heldTrucks] = await Promise.all([
      prisma.inboundReceipt.findMany({
        where: { gatepassNo: { in: buyGatepassRefs } },
        select: { gatepassNo: true, status: true, paidAmountPkr: true },
      }),
      prisma.pendingTruck.findMany({
        where: {
          gatepassNo: { in: buyGatepassRefs },
          gateInvoiceStage: { in: ["PARTIAL_PAYMENT", "HOLD_OLD_DUES"] },
        },
        select: { gatepassNo: true },
      }),
    ]);
    for (const t of heldTrucks) heldGatepasses.add(t.gatepassNo);
    const byGp = new Map<string, string[]>();
    for (const r of receipts) {
      if (!r.gatepassNo) continue;
      const list = byGp.get(r.gatepassNo) ?? [];
      list.push(r.status);
      byGp.set(r.gatepassNo, list);
      paidByGatepass.set(r.gatepassNo, (paidByGatepass.get(r.gatepassNo) ?? 0) + num(r.paidAmountPkr));
    }
    for (const [gp, statuses] of byGp) {
      if (statuses.length > 0 && statuses.every((s) => s === "PAID")) paidGatepasses.add(gp);
    }
  }

  const settledStages = new Set<string>(SETTLED_STAGES);

  const notePaidByKey = new Map<string, number>();
  const noteVoucherAggs = await prisma.voucher.groupBy({
    by: ["counterpartyId", "noteRef"],
    where: { status: "APPROVED", noteRef: { not: null } },
    _sum: { amountPkr: true },
  });
  for (const g of noteVoucherAggs) {
    if (!g.noteRef) continue;
    notePaidByKey.set(`${g.counterpartyId}:${g.noteRef}`, numOrNull(g._sum.amountPkr) ?? 0);
  }

  const byAccount = new Map<string, LedgerEntryView[]>();
  for (const e of entries) {
    const stage = (e.truckId ? truckStage.get(e.truckId) : null) ?? null;
    // A debit is settled once the money behind it has moved. On the buy side
    // that is the receipt reaching PAID through the payment process — there is
    // no credit row to wait for; on the sell side it is the truck being paid,
    // or a settlement invoice fully collected.
    const invStatus = (e.invoiceId ? invoiceStatus.get(e.invoiceId) : null) ?? null;
    const billedPkr = num(e.amountPkr);
    const isOpenNote = e.noteStatus === "UNPAID" && e.sourceType === "ADJUSTMENT";
    const notePaid =
      isOpenNote && e.sourceRef
        ? (notePaidByKey.get(`${e.counterpartyId}:${e.sourceRef}`) ?? 0)
        : 0;
    // A cancellation note answers to its own status, not to a gatepass or a
    // truck stage — it is settled the moment a voucher pays it.
    const settled =
      e.noteStatus != null
        ? e.noteStatus === "PAID"
        : e.entryType === "DEBIT" &&
          (e.sourceType === "INVOICE"
            ? invStatus === "PAID"
            : e.side === "BUY"
              ? e.sourceRef != null && paidGatepasses.has(e.sourceRef)
              : stage != null && settledStages.has(stage));
    // How much of this debit the money has actually covered. On the buy side
    // that is the amount paid against the gatepass, so a part-released truck
    // shows its paid share rather than all-or-nothing. Open notes track partial
    // vouchers against the same noteRef sub-ledger.
    const isBuyGateInvoice = e.side === "BUY" && e.sourceType === "GATEPASS";
    const paidPkr = isOpenNote
      ? notePaid
      : e.entryType !== "DEBIT"
        ? 0
        : isBuyGateInvoice
          ? Math.min(billedPkr, e.sourceRef ? (paidByGatepass.get(e.sourceRef) ?? 0) : 0)
          : settled
            ? billedPkr
            : 0;
    // Every buy debit posts money that has moved, never a claim: a gate invoice
    // grows with each part-payment finance approves. Open notes post only what
    // vouchers have collected so far; the full claim stays on billedPkr.
    const postedPkr =
      isOpenNote || (e.entryType === "DEBIT" && e.side === "BUY")
        ? paidPkr
        : billedPkr;
    // A deliberate hold is a decision, not an overdue payable — it never ages.
    const held = e.side === "BUY" && e.sourceRef != null && heldGatepasses.has(e.sourceRef);

    const view: LedgerEntryView = {
      id: e.id,
      entryDate: e.entryDate,
      entryType: e.entryType,
      amountPkr: postedPkr,
      billedPkr,
      sourceType: e.sourceType,
      sourceRef: e.sourceRef,
      tradeRef: e.tradeRef,
      truckId: e.truckId,
      voucherNo: e.voucher?.voucherNo ?? (e.sourceType === "VOUCHER" ? e.sourceRef : null),
      dueDate: e.dueDate,
      // Sell-side debits only — payables are paid outright, so they never age.
      // A note carries no due date either: it is settled on approval, not on
      // terms, so ageing it would only ever read as overdue.
      agingBucket:
        e.entryType === "DEBIT" && e.side === "SELL" && e.noteStatus == null
          ? agingBucketFor(e.dueDate)
          : null,
      saleStage: stage,
      settlementStatus: invStatus,
      settled,
      paidPkr,
      held,
      noteStatus: e.noteStatus,
      noteSettledByVoucherNo: e.noteSettledByVoucherNo,
      settlesNoteRef: e.voucher?.noteRef ?? null,
      note: e.note,
    };
    const key = `${e.counterpartyId}:${e.side}`;
    const list = byAccount.get(key) ?? [];
    list.push(view);
    byAccount.set(key, list);
  }

  const earmarkStages = new Set<string>(VOUCHER_EARMARK_STAGES);

  const accounts: CounterpartyLedgerView[] = [];
  for (const cp of counterparties) {
    for (const side of ["SELL", "BUY"] as const) {
      const rawList = byAccount.get(`${cp.id}:${side}`) ?? [];
      // Inbound payments settle on receipt PAID — buy-side PAYMENT credits are
      // legacy audit noise and must not appear in the payable view or totals.
      const list =
        side === "BUY"
          ? rawList.filter((e) => e.sourceType !== "PAYMENT")
          : rawList;
      // SELL accounts always shown (voucher targets); BUY only when active.
      if (side === "BUY" && list.length === 0) continue;
      let totalDebit = 0;
      let totalBilled = 0;
      let totalCredit = 0;
      let settledDebit = 0;
      let earmarked = 0;
      const aging = emptyAging();
      for (const e of list) {
        // A settled note and the voucher that paid it cancel each other out.
        // Both rows stay visible for the audit trail, but neither weighs on
        // what the account owes any more — the claim is closed. The pair also
        // has to stay out of the credit total: money raised to close a note is
        // spoken for, and counting it would read as funding free for a truck.
        if (e.noteStatus === "PAID" || e.settlesNoteRef) continue;
        if (e.entryType === "DEBIT") {
          totalDebit += e.amountPkr;
          totalBilled += e.billedPkr;
          const stage = e.saleStage;
          if (side === "SELL" && ((stage && earmarkStages.has(stage)) || e.sourceType === "INVOICE")) {
            earmarked += e.billedPkr;
          }
          // Paid money is not owed; what is left ages unless it is being held
          // deliberately, and a fully settled debit never ages.
          settledDebit += e.paidPkr;
          const openPkr = Math.max(0, e.billedPkr - e.paidPkr);
          // Payables do not age: a purchase is paid outright and the truck is
          // released, so a buy debit is either paid or deliberately held —
          // neither is an overdue receivable. Aging is a sell-side measure.
          if (side === "SELL" && !e.settled && !e.held && openPkr > 0 && e.agingBucket) {
            aging[e.agingBucket] += openPkr;
          }
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
        totalBilledPkr: Math.round(totalBilled * 100) / 100,
        settledDebitPkr: Math.round(settledDebit * 100) / 100,
        // What the account still owes answers to the bill, not to the part of
        // it that has already been debited.
        outstandingDebitPkr: Math.round((totalBilled - settledDebit) * 100) / 100,
        balancePkr: Math.round((totalCredit - totalBilled) * 100) / 100,
        availableCreditPkr:
          side === "SELL" ? Math.round(Math.max(0, totalCredit - earmarked) * 100) / 100 : 0,
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
 * Receivable debits past their due date that are still unsettled — surfaced as
 * alerts on every portal dashboard.
 *
 * Sell side only. A payable is paid outright before the truck is released, so
 * it is never overdue; when the trader holds one back that is a decision, not a
 * missed payment, and it must not raise an alert.
 */
export async function getOverdueLedgerAlerts(): Promise<OverdueLedgerAlert[]> {
  const now = new Date();
  const entries = await prisma.counterpartyLedgerEntry.findMany({
    where: { side: "SELL", entryType: "DEBIT", dueDate: { lt: now } },
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
