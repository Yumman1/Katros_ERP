import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import { num } from "@/server/db/convert";
import { COUNTER, nextRef } from "@/server/db/counters";
import { advanceTaxRateFor } from "@/lib/finance-policy";
import { appendTradeActivity } from "@/server/trade-activity";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Settlement billing — the money side of a trade closed with NO delivery.
 *
 * A settled trade never produces inventory and never gets a gatepass truck, so
 * the outbound truck that normally raises the buyer's receivable never exists.
 * Settlement invoices take its place:
 *
 *   CEO approves settlement ──▶ trade SETTLED, collection opens
 *   trader raises invoices  ──▶ DEBIT on the counterparty's SELL ledger
 *   execution enters voucher ─▶ finance approves ──▶ CREDIT on the same ledger
 *   credits cover the trade amount ──▶ trade closed (settlementClosedAt)
 *
 * The invoices are what the vouchers are collected against, and the ledger is
 * the single place the two meet.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Which ledger account a settled trade lives on. A purchase settles on the BUY
 * account and a sale on the SELL account — the invoice debit and the voucher
 * credit always meet on the same side, and the two ledgers never mix.
 */
export function settlementSideFor(direction: string): "BUY" | "SELL" {
  return direction === "BUY" ? "BUY" : "SELL";
}

/** Rounding headroom (PKR) when comparing money totals. */
const EPSILON = 0.005;

type TargetTrade = {
  direction: string;
  quantity: Prisma.Decimal;
  price: Prisma.Decimal;
  pricePerCanonicalQty: Prisma.Decimal | null;
  counterparty: { taxFilerStatus: "FILER" | "NON_FILER" | null } | null;
};

/**
 * The full amount to be gathered for a settled trade: quantity × price, plus
 * 236G advance tax on sales only — 236G is a tax on selling, so a purchase
 * settles at its bare notional.
 */
export async function settlementTargetPkr(trade: TargetTrade): Promise<{
  notionalPkr: number;
  taxRatePct: number;
  advanceTaxPkr: number;
  targetPkr: number;
}> {
  const notional = round2(
    num(trade.quantity) *
      (trade.pricePerCanonicalQty != null ? num(trade.pricePerCanonicalQty) : num(trade.price)),
  );
  if (trade.direction !== "SELL") {
    return { notionalPkr: notional, taxRatePct: 0, advanceTaxPkr: 0, targetPkr: notional };
  }
  const { getFinancePolicy } = await import("./finance/policy");
  const policy = await getFinancePolicy();
  const taxRatePct = advanceTaxRateFor(policy, trade.counterparty?.taxFilerStatus);
  const advanceTaxPkr = round2(notional * (taxRatePct / 100));
  return {
    notionalPkr: notional,
    taxRatePct,
    advanceTaxPkr,
    targetPkr: round2(notional + advanceTaxPkr),
  };
}

const SETTLEMENT_TRADE_SELECT = {
  id: true,
  tradeRef: true,
  traderName: true,
  direction: true,
  quantity: true,
  quantityUnit: true,
  price: true,
  pricePerCanonicalQty: true,
  currency: true,
  tradeStatus: true,
  directSettled: true,
  settlementNote: true,
  settlementApprovedBy: true,
  settlementApprovedAt: true,
  settlementClosedAt: true,
  settlementClosedBy: true,
  counterpartyId: true,
  counterparty: { select: { id: true, name: true, code: true, taxFilerStatus: true } },
  commodity: { select: { code: true, name: true } },
} as const;

export type SettlementInvoiceView = {
  id: string;
  invoiceRef: string;
  invoiceDate: Date;
  dueDate: Date;
  amountPkr: number;
  /** Portion of collected money allocated to this invoice (oldest first). */
  paidPkr: number;
  outstandingPkr: number;
  status: "DRAFT" | "SENT" | "PARTIALLY_PAID" | "PAID" | "OVERDUE";
  note: string | null;
  voidedAt: Date | null;
  voidedBy: string | null;
  createdAt: Date;
};

export type SettlementVoucherView = {
  voucherNo: string;
  amountPkr: number;
  status: "PENDING_FINANCE" | "APPROVED" | "REJECTED";
  method: string | null;
  reference: string | null;
  enteredByName: string;
  resolvedByName: string | null;
  createdAt: Date;
};

export type TradeSettlementView = {
  tradeRef: string;
  traderName: string;
  direction: string;
  commodityCode: string;
  commodityName: string;
  counterpartyId: string;
  counterpartyName: string;
  counterpartyCode: string;
  quantity: number;
  quantityUnit: string;
  currency: string;
  settlementNote: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  closedAt: Date | null;
  closedBy: string | null;
  /** quantity × price. */
  notionalPkr: number;
  taxRatePct: number;
  advanceTaxPkr: number;
  /** Full amount to gather — notional (+ 236G on sales). */
  targetPkr: number;
  /** Sum of live (non-void) settlement invoices. */
  invoicedPkr: number;
  /** Target not yet invoiced. */
  uninvoicedPkr: number;
  /** Ledger credit gathered against this trade (approved vouchers). */
  collectedPkr: number;
  /** Target still to collect. */
  outstandingPkr: number;
  /** Money received but not yet backed by an invoice. */
  unbilledCollectedPkr: number;
  /** 0–100, collected against target. */
  progressPct: number;
  isClosed: boolean;
  invoices: SettlementInvoiceView[];
  vouchers: SettlementVoucherView[];
  /** Vouchers entered but not yet approved by finance — not in the ledger yet. */
  pendingVoucherPkr: number;
};

/**
 * Money gathered in the ledger against a trade — approved voucher credits.
 * A trade sits on exactly one account, so no side filter is needed. The
 * sourceType filter is load-bearing: a purchase trade also carries BUY credits
 * from paying the seller (sourceType PAYMENT), and money paid out is not money
 * collected. Only voucher credits settle a trade.
 */
export async function collectedForTradePkr(tradeRef: string, db: Db = prisma): Promise<number> {
  const agg = await db.counterpartyLedgerEntry.aggregate({
    where: { tradeRef, entryType: "CREDIT", sourceType: "VOUCHER" },
    _sum: { amountPkr: true },
  });
  return round2(num(agg._sum.amountPkr ?? 0));
}

function invoiceStatusFor(
  amount: number,
  paid: number,
  dueDate: Date,
  now: Date,
): SettlementInvoiceView["status"] {
  if (paid + EPSILON >= amount) return "PAID";
  if (paid > EPSILON) return "PARTIALLY_PAID";
  return dueDate.getTime() < now.getTime() ? "OVERDUE" : "SENT";
}

export type Allocation = {
  paidPkr: number;
  outstandingPkr: number;
  status: SettlementInvoiceView["status"];
};

/**
 * Spread the money gathered so far across live invoices oldest-first, so each
 * one carries a real paid/outstanding figure. Pure — the single definition of
 * how collected money maps onto invoices.
 */
export function allocateCollected<T extends { amountPkr: number; dueDate: Date }>(
  invoices: T[],
  collectedPkr: number,
  now: Date = new Date(),
): Array<T & Allocation> {
  let unallocated = collectedPkr;
  return invoices.map((inv) => {
    const paidPkr = round2(Math.min(inv.amountPkr, Math.max(0, unallocated)));
    unallocated = round2(unallocated - paidPkr);
    return {
      ...inv,
      paidPkr,
      outstandingPkr: round2(inv.amountPkr - paidPkr),
      status: invoiceStatusFor(inv.amountPkr, paidPkr, inv.dueDate, now),
    };
  });
}

/** Is the whole trade amount now sitting in the ledger? */
export function settlementCovered(collectedPkr: number, targetPkr: number): boolean {
  return targetPkr > 0 && collectedPkr + EPSILON >= targetPkr;
}

/**
 * Full settlement picture for one trade. Collected money is allocated across
 * live invoices oldest-first, so each invoice carries a real paid/outstanding
 * figure rather than a flat "sent" flag.
 */
export async function getTradeSettlement(tradeRef: string): Promise<TradeSettlementView | null> {
  const ref = tradeRef.trim();
  const trade = await prisma.trade.findUnique({
    where: { tradeRef: ref },
    select: SETTLEMENT_TRADE_SELECT,
  });
  if (!trade || !trade.directSettled) return null;

  const [invoiceRows, voucherRows, collectedPkr] = await Promise.all([
    prisma.invoice.findMany({
      where: { tradeId: trade.id, invoiceType: "SETTLEMENT" },
      orderBy: [{ invoiceDate: "asc" }, { createdAt: "asc" }],
    }),
    prisma.voucher.findMany({
      where: { tradeRef: ref },
      orderBy: { createdAt: "desc" },
    }),
    collectedForTradePkr(ref),
  ]);

  const { notionalPkr, taxRatePct, advanceTaxPkr, targetPkr } = await settlementTargetPkr(trade);

  const now = new Date();
  const allocated = new Map(
    allocateCollected(
      invoiceRows
        .filter((i) => !i.voidedAt)
        .map((i) => ({ id: i.id, amountPkr: round2(num(i.amount)), dueDate: i.dueDate })),
      collectedPkr,
      now,
    ).map((a) => [a.id, a]),
  );
  const invoices: SettlementInvoiceView[] = invoiceRows.map((inv) => {
    const amountPkr = round2(num(inv.amount));
    const a = allocated.get(inv.id);
    return {
      id: inv.id,
      invoiceRef: inv.invoiceRef,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      amountPkr,
      // A void invoice carries no receivable, so it collects nothing.
      paidPkr: a?.paidPkr ?? 0,
      outstandingPkr: a?.outstandingPkr ?? 0,
      status: a?.status ?? "DRAFT",
      note: inv.note,
      voidedAt: inv.voidedAt,
      voidedBy: inv.voidedBy,
      createdAt: inv.createdAt,
    };
  });

  const invoicedPkr = round2(
    invoiceRows.reduce((s, i) => (i.voidedAt ? s : s + num(i.amount)), 0),
  );
  const pendingVoucherPkr = round2(
    voucherRows.reduce((s, v) => (v.status === "PENDING_FINANCE" ? s + num(v.amountPkr) : s), 0),
  );

  return {
    tradeRef: trade.tradeRef,
    traderName: trade.traderName,
    direction: trade.direction,
    commodityCode: trade.commodity.code,
    commodityName: trade.commodity.name,
    counterpartyId: trade.counterpartyId,
    counterpartyName: trade.counterparty.name,
    counterpartyCode: trade.counterparty.code,
    quantity: num(trade.quantity),
    quantityUnit: trade.quantityUnit,
    currency: trade.currency,
    settlementNote: trade.settlementNote,
    approvedBy: trade.settlementApprovedBy,
    approvedAt: trade.settlementApprovedAt,
    closedAt: trade.settlementClosedAt,
    closedBy: trade.settlementClosedBy,
    notionalPkr,
    taxRatePct,
    advanceTaxPkr,
    targetPkr,
    invoicedPkr,
    uninvoicedPkr: round2(Math.max(0, targetPkr - invoicedPkr)),
    collectedPkr,
    outstandingPkr: round2(Math.max(0, targetPkr - collectedPkr)),
    unbilledCollectedPkr: round2(Math.max(0, collectedPkr - invoicedPkr)),
    progressPct: targetPkr > 0 ? Math.min(100, Math.round((collectedPkr / targetPkr) * 100)) : 0,
    isClosed: trade.settlementClosedAt != null,
    invoices,
    vouchers: voucherRows.map((v) => ({
      voucherNo: v.voucherNo,
      amountPkr: num(v.amountPkr),
      status: v.status,
      method: v.method,
      reference: v.reference,
      enteredByName: v.enteredByName,
      resolvedByName: v.resolvedByName,
      createdAt: v.createdAt,
    })),
    pendingVoucherPkr,
  };
}

/**
 * Raise a settlement invoice against a settled trade and post its receivable
 * to the counterparty's SELL ledger. The invoice and its ledger debit are one
 * transaction — an invoice can never exist without its receivable.
 */
export async function raiseSettlementInvoice(input: {
  tradeRef: string;
  amountPkr: number;
  dueDate?: Date | null;
  note?: string | null;
  createdById: string;
  actorName: string;
}): Promise<{ invoiceRef: string }> {
  const ref = input.tradeRef.trim();
  if (!Number.isFinite(input.amountPkr) || input.amountPkr <= 0) {
    throw new Error("Invoice amount must be positive");
  }
  const amountPkr = round2(input.amountPkr);

  const trade = await prisma.trade.findUnique({
    where: { tradeRef: ref },
    select: SETTLEMENT_TRADE_SELECT,
  });
  if (!trade) throw new Error("Trade not found");
  if (!trade.directSettled) {
    throw new Error("Only a directly settled trade can be invoiced for settlement");
  }
  if (trade.settlementClosedAt) {
    throw new Error("This settlement is already closed — the full trade amount has been collected");
  }

  const { targetPkr } = await settlementTargetPkr(trade);
  const invoicedAgg = await prisma.invoice.aggregate({
    where: { tradeId: trade.id, invoiceType: "SETTLEMENT", voidedAt: null },
    _sum: { amount: true },
  });
  const alreadyInvoiced = round2(num(invoicedAgg._sum.amount ?? 0));
  if (alreadyInvoiced + amountPkr > targetPkr + EPSILON) {
    const left = round2(Math.max(0, targetPkr - alreadyInvoiced));
    throw new Error(
      `Invoicing ${amountPkr.toLocaleString("en-PK")} PKR would exceed the trade amount — only ${left.toLocaleString("en-PK")} PKR is left to invoice of ${targetPkr.toLocaleString("en-PK")} PKR`,
    );
  }

  const now = new Date();
  const dueDate = input.dueDate ?? now;
  const seq = await nextRef(COUNTER.SETTLEMENT_INVOICE);
  const invoiceRef = `SIN-${String(seq).padStart(5, "0")}`;

  await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.create({
      data: {
        invoiceRef,
        tradeId: trade.id,
        counterpartyId: trade.counterpartyId,
        invoiceDate: now,
        dueDate,
        amount: amountPkr,
        quantity: null,
        currency: trade.currency,
        status: "SENT",
        invoiceType: "SETTLEMENT",
        note: input.note?.trim() || null,
        createdById: input.createdById,
      },
    });
    // The receivable that replaces the outbound truck's debit — on the buy
    // account for a purchase, the sell account for a sale.
    await tx.counterpartyLedgerEntry.create({
      data: {
        counterpartyId: trade.counterpartyId,
        side: settlementSideFor(trade.direction),
        entryType: "DEBIT",
        amountPkr,
        sourceType: "INVOICE",
        sourceRef: invoiceRef,
        tradeRef: ref,
        invoiceId: invoice.id,
        dueDate,
        note: input.note?.trim() || `Settlement invoice for ${ref}`,
      },
    });
  });

  await appendTradeActivity(ref, {
    actorName: input.actorName,
    actorSide: "TRADER",
    kind: "SETTLEMENT_INVOICED",
    requiresApproval: false,
    summary: `Settlement invoice ${invoiceRef} raised for ${amountPkr.toLocaleString("en-PK")} PKR`,
    note: input.note?.trim() || null,
  });

  // Money may already be sitting in the ledger (advance received before the
  // invoice was raised) — that can complete the settlement right away.
  await syncSettlementCollection(ref, input.actorName);
  return { invoiceRef };
}

/** Reverse a settlement invoice raised in error, removing its ledger debit. */
export async function voidSettlementInvoice(input: {
  tradeRef: string;
  invoiceId: string;
  actorName: string;
}): Promise<void> {
  const ref = input.tradeRef.trim();
  const invoice = await prisma.invoice.findUnique({
    where: { id: input.invoiceId },
    select: {
      id: true,
      invoiceRef: true,
      amount: true,
      voidedAt: true,
      invoiceType: true,
      trade: { select: { tradeRef: true, settlementClosedAt: true } },
    },
  });
  if (!invoice || invoice.invoiceType !== "SETTLEMENT") throw new Error("Settlement invoice not found");
  if (invoice.trade.tradeRef !== ref) throw new Error("Invoice does not belong to this trade");
  if (invoice.voidedAt) throw new Error("This invoice is already void");
  if (invoice.trade.settlementClosedAt) {
    throw new Error("This settlement is closed — its invoices can no longer be changed");
  }

  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { voidedAt: new Date(), voidedBy: input.actorName, status: "DRAFT" },
    });
    // Drop the receivable with the invoice that raised it.
    await tx.counterpartyLedgerEntry.deleteMany({ where: { invoiceId: invoice.id } });
  });

  await appendTradeActivity(ref, {
    actorName: input.actorName,
    actorSide: "TRADER",
    kind: "SETTLEMENT_INVOICED",
    requiresApproval: false,
    summary: `Settlement invoice ${invoice.invoiceRef} voided (${round2(num(invoice.amount)).toLocaleString("en-PK")} PKR)`,
  });
}

/**
 * Refresh a settled trade's collection state: push each invoice's status to
 * match the money gathered, and close the trade once the ledger holds the
 * whole trade amount. Safe to call repeatedly — closing is idempotent.
 */
export async function syncSettlementCollection(
  tradeRef: string,
  actorName = "System",
): Promise<{ closed: boolean; collectedPkr: number; targetPkr: number } | null> {
  const ref = tradeRef.trim();
  const trade = await prisma.trade.findUnique({
    where: { tradeRef: ref },
    select: SETTLEMENT_TRADE_SELECT,
  });
  if (!trade || !trade.directSettled) return null;

  const [{ targetPkr }, collectedPkr, invoiceRows] = await Promise.all([
    settlementTargetPkr(trade),
    collectedForTradePkr(ref),
    prisma.invoice.findMany({
      where: { tradeId: trade.id, invoiceType: "SETTLEMENT", voidedAt: null },
      orderBy: [{ invoiceDate: "asc" }, { createdAt: "asc" }],
      select: { id: true, amount: true, dueDate: true, status: true },
    }),
  ]);

  // Allocate what has been collected across invoices, oldest first.
  const now = new Date();
  const allocated = allocateCollected(
    invoiceRows.map((i) => ({
      id: i.id,
      amountPkr: round2(num(i.amount)),
      dueDate: i.dueDate,
      was: i.status,
    })),
    collectedPkr,
    now,
  );
  for (const a of allocated) {
    if (a.status !== a.was) {
      await prisma.invoice.update({ where: { id: a.id }, data: { status: a.status } });
    }
  }

  const covered = settlementCovered(collectedPkr, targetPkr);
  if (covered && !trade.settlementClosedAt) {
    // updateMany + null guard: two concurrent voucher approvals can't both close.
    const res = await prisma.trade.updateMany({
      where: { tradeRef: ref, settlementClosedAt: null },
      data: { settlementClosedAt: now, settlementClosedBy: actorName },
    });
    if (res.count > 0) {
      await appendTradeActivity(ref, {
        actorName,
        actorSide: "EXECUTION",
        kind: "SETTLEMENT_CLOSED",
        requiresApproval: false,
        summary: `Settlement closed — full trade amount of ${targetPkr.toLocaleString("en-PK")} PKR gathered in the ledger`,
      });
    }
  }
  return { closed: covered, collectedPkr, targetPkr };
}

export type SettledTradeRow = {
  tradeRef: string;
  direction: string;
  commodityCode: string;
  counterpartyName: string;
  quantity: number;
  quantityUnit: string;
  targetPkr: number;
  invoicedPkr: number;
  collectedPkr: number;
  outstandingPkr: number;
  progressPct: number;
  invoiceCount: number;
  isClosed: boolean;
  closedAt: Date | null;
  approvedAt: Date | null;
};

/**
 * Settled trades with their collection progress — the Settled tab in My
 * Trades. Pass a trader name to scope it to that trader's own trades.
 */
export async function listSettledTrades(traderName?: string): Promise<SettledTradeRow[]> {
  const { canonicalTraderName, traderNamesMatch } = await import("@/lib/trader-identity");
  const rows = await prisma.trade.findMany({
    where: { directSettled: true },
    select: SETTLEMENT_TRADE_SELECT,
    orderBy: { settlementApprovedAt: "desc" },
  });
  const mine = traderName
    ? rows.filter((t) => traderNamesMatch(t.traderName, canonicalTraderName(traderName)))
    : rows;
  if (mine.length === 0) return [];

  const refs = mine.map((t) => t.tradeRef);
  const [credits, invoices] = await Promise.all([
    prisma.counterpartyLedgerEntry.groupBy({
      by: ["tradeRef"],
      // Voucher credits only — see collectedForTradePkr: paying a seller also
      // credits the buy account, and that is not settlement money collected.
      where: { tradeRef: { in: refs }, entryType: "CREDIT", sourceType: "VOUCHER" },
      _sum: { amountPkr: true },
    }),
    prisma.invoice.groupBy({
      by: ["tradeId"],
      where: { tradeId: { in: mine.map((t) => t.id) }, invoiceType: "SETTLEMENT", voidedAt: null },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);
  const collectedBy = new Map(credits.map((c) => [c.tradeRef ?? "", round2(num(c._sum.amountPkr ?? 0))]));
  const invoicedBy = new Map(
    invoices.map((i) => [i.tradeId, { sum: round2(num(i._sum.amount ?? 0)), count: i._count._all }]),
  );

  return Promise.all(
    mine.map(async (t) => {
      const { targetPkr } = await settlementTargetPkr(t);
      const collectedPkr = collectedBy.get(t.tradeRef) ?? 0;
      const inv = invoicedBy.get(t.id);
      return {
        tradeRef: t.tradeRef,
        direction: t.direction,
        commodityCode: t.commodity.code,
        counterpartyName: t.counterparty.name,
        quantity: num(t.quantity),
        quantityUnit: t.quantityUnit,
        targetPkr,
        invoicedPkr: inv?.sum ?? 0,
        collectedPkr,
        outstandingPkr: round2(Math.max(0, targetPkr - collectedPkr)),
        progressPct:
          targetPkr > 0 ? Math.min(100, Math.round((collectedPkr / targetPkr) * 100)) : 0,
        invoiceCount: inv?.count ?? 0,
        isClosed: t.settlementClosedAt != null,
        closedAt: t.settlementClosedAt,
        approvedAt: t.settlementApprovedAt,
      };
    }),
  );
}
