import { advanceTrade } from "./purchase-advances";
import { advanceAmount } from "@/lib/purchase-advance";
import { tradeEntity } from "@/lib/sesame-entity";
import { prisma } from "@/server/db";
import { num } from "@/server/db/convert";
import { allocateSerial, SERIALS } from "@/server/db/serials";
import {
  listOpenSettlementNotes,
  markSettlementNotePaid,
  noteBalance,
  noteShouldClose,
  postCreditForVoucher,
} from "./ledger";

export type VoucherView = {
  truckNo: string | null;
  purchaseProfile: string | null;
  builtyNumber: string | null;
  transporterName: string | null;
  advancePercentage: number | null;
  advanceWeightKg: number | null;
  calculatedAdvancePkr: number | null;
  availableAdvancePkr: number;
  advanceTruckId: string | null;
  invoiceNo: string | null;
  truckPaid: boolean;
  adjustments: { amountPkr: number; tradeRef: string; builty: string; invoice: string | null }[];
  executionEntity: string;
  commodityCode: string | null;
  id: string;
  voucherNo: string;
  counterpartyId: string;
  counterpartyName: string;
  counterpartyCode: string;
  /** Ledger account credited — SELL for a sale, BUY for a purchase settlement. */
  side: "BUY" | "SELL";
  /** Trade reference for reconciliation; null = no trade tagged. */
  tradeRef: string | null;
  /** Cancellation / short-close note this voucher settles; null otherwise. */
  noteRef: string | null;
  amountPkr: number;
  method: string | null;
  reference: string | null;
  bankName: string | null;
  note: string | null;
  status: "PENDING_FINANCE" | "APPROVED" | "REJECTED";
  enteredByName: string;
  resolvedByName: string | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  voucherDate: Date;
  createdAt: Date;
};

const VOUCHER_INCLUDE = {
  counterparty: { select: { name: true, code: true } },
  advanceAllocations: { include: { receipt: { include: { gatepassTruck: true } } } },
  advanceTruck: true,
} as const;

type VoucherRow = Awaited<ReturnType<typeof prisma.voucher.findMany<{ include: typeof VOUCHER_INCLUDE }>>>[number];

/** Normalize bank for duplicate detection (empty when not a bank transfer). */
export function normalizeVoucherBankKey(bankName: string | null | undefined): string {
  return (bankName?.trim() ?? "").toLowerCase();
}

export function normalizeVoucherReference(reference: string): string {
  return reference.trim().toLowerCase();
}

/** Calendar day (UTC) for voucher-date matching. */
export function voucherDateCalendarKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function vouchersSharePaymentKey(
  a: {
    bankName: string | null | undefined;
    reference: string | null | undefined;
    voucherDate: Date;
    amountPkr: number | string | { toString(): string };
  },
  b: {
    bankName: string | null | undefined;
    reference: string | null | undefined;
    voucherDate: Date;
    amountPkr: number | string | { toString(): string };
  },
): boolean {
  if (normalizeVoucherReference(a.reference ?? "") !== normalizeVoucherReference(b.reference ?? "")) {
    return false;
  }
  if (normalizeVoucherBankKey(a.bankName) !== normalizeVoucherBankKey(b.bankName)) {
    return false;
  }
  if (voucherDateCalendarKey(a.voucherDate) !== voucherDateCalendarKey(b.voucherDate)) {
    return false;
  }
  return Math.abs(Number(a.amountPkr) - Number(b.amountPkr)) < 0.005;
}

/**
 * Another pending or approved voucher with the same bank + reference + date +
 * amount — blocks double entry of the same payment slip.
 */
export async function findDuplicateVoucher(input: {
  bankName: string | null;
  reference: string;
  voucherDate: Date;
  amountPkr: number;
}): Promise<{ voucherNo: string; status: string } | null> {
  const dayStart = new Date(input.voucherDate);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(input.voucherDate);
  dayEnd.setUTCHours(23, 59, 59, 999);

  const candidates = await prisma.voucher.findMany({
    where: {
      status: { in: ["PENDING_FINANCE", "APPROVED"] },
      voucherDate: { gte: dayStart, lte: dayEnd },
    },
    select: {
      voucherNo: true,
      status: true,
      bankName: true,
      reference: true,
      voucherDate: true,
      amountPkr: true,
    },
  });

  const probe = {
    bankName: input.bankName,
    reference: input.reference,
    voucherDate: input.voucherDate,
    amountPkr: input.amountPkr,
  };

  const dup = candidates.find((v) => vouchersSharePaymentKey(probe, v));
  return dup ? { voucherNo: dup.voucherNo, status: dup.status } : null;
}

function voucherRowToView(row: VoucherRow): VoucherView {
  return {
    truckNo: row.truckNo,
    purchaseProfile: row.purchaseProfile,
    builtyNumber: row.builtyNumber,
    transporterName: row.transporterName,
    advancePercentage: row.advancePercentage == null ? null : num(row.advancePercentage),
    advanceWeightKg: row.advanceWeightKg == null ? null : num(row.advanceWeightKg),
    calculatedAdvancePkr: row.calculatedAdvancePkr == null ? null : num(row.calculatedAdvancePkr),
    availableAdvancePkr: row.builtyNumber && row.status === "APPROVED" ? Math.max(0, num(row.amountPkr) - row.advanceAllocations.reduce((s, a) => s + num(a.amountPkr), 0)) : 0,
    advanceTruckId: row.advanceTruckId,
    invoiceNo: row.advanceTruck?.gateInvoiceNo ?? null,
    truckPaid: false,
    adjustments: row.advanceAllocations.map(a => ({ amountPkr: num(a.amountPkr), tradeRef: a.receipt.tradeRef, builty: a.receipt.biltyNo, invoice: a.receipt.gatepassTruck?.gateInvoiceNo ?? a.receipt.billNo })),
    executionEntity: row.executionEntity,
    id: row.id,
    commodityCode: row.commodityCode,
    voucherNo: row.voucherNo,
    counterpartyId: row.counterpartyId,
    counterpartyName: row.counterparty.name,
    counterpartyCode: row.counterparty.code,
    side: row.side,
    tradeRef: row.tradeRef,
    noteRef: row.noteRef,
    amountPkr: num(row.amountPkr),
    method: row.method,
    reference: row.reference,
    bankName: row.bankName,
    note: row.note,
    status: row.status,
    enteredByName: row.enteredByName,
    resolvedByName: row.resolvedByName,
    resolvedAt: row.resolvedAt,
    resolutionNote: row.resolutionNote,
    voucherDate: row.voucherDate,
    createdAt: row.createdAt,
  };
}

/** Execution enters a payment voucher — pending until finance approves it. */
export async function createVoucher(input: {
  truckNo?: string;
  advancePercentage?: number;
  builtyNumber?: string;
  transporterName?: string;
  advanceWeightKg?: number;
  executionEntity?: "PAK" | "FZCO";
  commodityCode?: string;
  counterpartyId: string;
  /** Ledger account to credit — SELL (a sale) or BUY (a purchase settlement). */
  side?: "BUY" | "SELL";
  /** Trade reference for reconciliation; null/undefined = no trade tagged. */
  tradeRef?: string | null;
  /** Cancellation / short-close note being settled — takes over from tradeRef. */
  noteRef?: string | null;
  amountPkr: number;
  method?: string | null;
  /** Bank slip, cheque or transfer reference. Finance supplies this for purchase requests. */
  reference?: string | null;
  bankName?: string | null;
  voucherDate?: Date | null;
  note?: string | null;
  enteredByName: string;
}): Promise<VoucherView> {
  if (!Number.isFinite(input.amountPkr) || input.amountPkr <= 0) {
    throw new Error("Voucher amount must be positive");
  }
  const purchaseRequest = input.side === "BUY";
  const reference = purchaseRequest ? null : input.reference?.trim() || null;
  if (!reference && !purchaseRequest) {
    throw new Error("Payment reference is required (slip, cheque, or transfer reference number)");
  }
  const method = purchaseRequest ? null : input.method?.trim() || null;
  const bankName = purchaseRequest ? null : input.bankName?.trim() || null;
  if (method?.toLowerCase() === "bank transfer" && !bankName) {
    throw new Error("Select a bank when payment method is Bank transfer");
  }
  const cp = await prisma.counterparty.findUnique({
    where: { id: input.counterpartyId },
    select: { id: true },
  });
  if (!cp) throw new Error("Counterparty not found");
  let side = input.side ?? "SELL";
  let tradeRef = input.tradeRef?.trim() || null;
  const noteRef = input.noteRef?.trim() || null;

  if (noteRef) {
    // A note voucher pays a cancellation claim in one or more pieces. The note
    // dictates the account and trade; each approved voucher posts to the ledger.
    const open = await listOpenSettlementNotes(input.counterpartyId);
    const note = open.find((n) => n.noteRef === noteRef);
    if (!note) {
      throw new Error(`${noteRef} is not an open note on this counterparty`);
    }
    if (input.amountPkr > note.remainingPkr + 0.005) {
      throw new Error(
        `${noteRef} has ${note.remainingPkr.toLocaleString("en-PK")} PKR remaining of ${note.billedPkr.toLocaleString("en-PK")} PKR — voucher exceeds what is due`,
      );
    }
    side = note.side;
    tradeRef = note.tradeRef;
  } else if (tradeRef && input.builtyNumber) {
    const { trade } = await advanceTrade(tradeRef);
    if (side !== "BUY" || trade.counterpartyId !== input.counterpartyId) throw new Error("Advance must match the purchase supplier");
  } else if (tradeRef) {
    const trade = await prisma.trade.findUnique({
      where: { tradeRef },
      select: {
        counterpartyId: true,
        direction: true,
        directSettled: true,
        settlementClosedAt: true,
      },
    });
    if (!trade) throw new Error("Trade not found: " + tradeRef);
    if (trade.counterpartyId !== input.counterpartyId) {
      throw new Error(`${tradeRef} does not belong to this counterparty`);
    }
    // A settled trade is collected on the account matching its direction, so
    // the voucher credit meets the settlement invoice's debit.
    if (trade.directSettled) {
      if (trade.settlementClosedAt) {
        throw new Error(
          `${tradeRef} is settled and closed — its full trade amount is already in the ledger`,
        );
      }
      const want = trade.direction === "BUY" ? "BUY" : "SELL";
      if (side !== want) {
        throw new Error(
          `${tradeRef} is a ${trade.direction} trade — record it as a ${want === "BUY" ? "purchase" : "sale"} so it credits the ${want.toLowerCase()} ledger`,
        );
      }
    } else if (trade.direction !== "SELL") {
      throw new Error(
        "Vouchers can only be linked to SELL trades (money coming in) or to settled trades",
      );
    } else if (side !== "SELL") {
      throw new Error(`${tradeRef} is a sale — record it as a sale so it credits the sell ledger`);
    }
  } else if (side !== "SELL") {
    // Sale vouchers without a trade ref still join the buyer's shared pool; purchase
    // vouchers must name the settled trade they pay.
    throw new Error("A purchase voucher must be recorded against a settled purchase trade");
  }

  const linkedTrade = tradeRef ? await prisma.trade.findUnique({ where: { tradeRef }, select: { tradeParams: true, commodity: { select: { code: true } } } }) : null;
  const commodityCode = linkedTrade?.commodity.code ?? input.commodityCode;
  const executionEntity = linkedTrade ? tradeEntity(linkedTrade.tradeParams) : input.executionEntity ?? "PAK";
  if (input.executionEntity && executionEntity !== input.executionEntity) throw new Error("Voucher trade belongs to another entity");
  if (input.commodityCode && linkedTrade && linkedTrade.commodity.code !== input.commodityCode) throw new Error("The voucher trade belongs to another execution commodity");
  if (!commodityCode) throw new Error("Select an execution commodity before entering a direct advance");
  if (!(await prisma.commodity.findUnique({ where: { code: commodityCode }, select: { id: true } }))) throw new Error("Unknown voucher commodity");
  let advance: { truckNo: string; purchaseProfile: string; builtyNumber: string; transporterName: string; advanceWeightKg: number; advancePercentage: number; calculatedAdvancePkr: number } | undefined;
  if (input.builtyNumber) {
    if (!tradeRef || noteRef || !/^\d+$/.test(input.builtyNumber.trim()) || !input.truckNo?.trim() || !input.transporterName?.trim() || !Number.isFinite(input.advanceWeightKg) || input.advanceWeightKg! <= 0) throw new Error("Enter a numeric builty, truck number, transporter and positive advance weight");
    if (await prisma.voucher.findFirst({ where: { tradeRef, builtyNumber: input.builtyNumber.trim(), truckNo: input.truckNo!.trim().toUpperCase(), status: { not: "REJECTED" } } })) throw new Error("This trade, builty and truck already have an active advance voucher");
    const terms = await advanceTrade(tradeRef);
    const percentage = input.advancePercentage ?? terms.percentage;
    if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) throw new Error("Advance percentage must be above 0 and at most 100");
    const contract = await prisma.executionContract.findUniqueOrThrow({where:{tradeRef}});
    advance = { truckNo: input.truckNo!.trim().toUpperCase(), purchaseProfile: contract.executionProfile, builtyNumber: input.builtyNumber.trim(), transporterName: input.transporterName.trim(), advanceWeightKg: input.advanceWeightKg!, advancePercentage: percentage, calculatedAdvancePkr: advanceAmount(input.advanceWeightKg!, terms.rateKg, percentage) };
  }
  const voucherDate = input.voucherDate ?? new Date();
  const duplicate = reference ? await findDuplicateVoucher({
    bankName,
    reference,
    voucherDate,
    amountPkr: input.amountPkr,
  }) : null;
  if (duplicate) {
    throw new Error(
      `This payment is already recorded as ${duplicate.voucherNo} (${duplicate.status === "APPROVED" ? "approved" : "pending finance"}) — same bank, reference, date, and amount`,
    );
  }

  const row = await allocateSerial(SERIALS.VOUCHER, (voucherNo) =>
    prisma.voucher.create({
      data: {
        voucherNo,
        truckNo: input.truckNo?.trim().toUpperCase() || null,
        ...advance,
        commodityCode,
        executionEntity,
        counterpartyId: input.counterpartyId,
        side,
        tradeRef,
        noteRef,
        amountPkr: input.amountPkr,
        method,
        reference,
        bankName,
        voucherDate,
        note: [advance ? `Truck ${advance.truckNo} · ${advance.purchaseProfile === "PURCHASE_SPOT" ? "Spot" : "Delivered"} · Builty ${advance.builtyNumber} · ${advance.transporterName} · ${advance.advancePercentage}% advance` : null, input.note?.trim()].filter(Boolean).join(" · ") || null,
        enteredByName: input.enteredByName,
      },
      include: VOUCHER_INCLUDE,
    }),
  );
  return voucherRowToView(row);
}

export async function listVouchers(filter?: {
  executionEntity?: "PAK" | "FZCO";
  commodityCode?: string;
  status?: "PENDING_FINANCE" | "APPROVED" | "REJECTED";
  counterpartyId?: string;
}): Promise<VoucherView[]> {
  const rows = await prisma.voucher.findMany({
    where: {
      ...(filter?.executionEntity ? { executionEntity: filter.executionEntity } : {}),
      ...(filter?.commodityCode ? { commodityCode: filter.commodityCode } : {}),
      ...(filter?.status ? { status: filter.status } : {}),
      ...(filter?.counterpartyId ? { counterpartyId: filter.counterpartyId } : {}),
    },
    include: VOUCHER_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  const gatepasses = rows.flatMap(r => r.advanceTruck ? [r.advanceTruck.gatepassNo] : []);
  const receipts = await prisma.inboundReceipt.findMany({ where: { gatepassNo: { in: gatepasses } }, select: { gatepassNo: true, status: true } });
  return rows.map(row => {
    const result = voucherRowToView(row);
    const linked = receipts.filter(r => r.gatepassNo === row.advanceTruck?.gatepassNo);
    result.truckPaid = linked.length > 0 && linked.every(r => r.status === "PAID") && !!result.invoiceNo;
    return result;
  });
}

/**
 * Finance approves a voucher — only then does the money become part of the
 * counterparty's ledger (CREDIT entry), which in turn unlocks outbound trucks
 * awaiting balance.
 */
export async function approveVoucher(
  voucherId: string,
  approvedByName: string,
  note?: string,
  paymentReference?: string,
  paymentDetails?: {method?: string; bankName?: string},
): Promise<VoucherView> {
  // Status flip + ledger credit are ONE transaction — an approved voucher can
  // never exist without its credit (and vice versa).
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('voucher-payment-approval'))::text`;
    const current = await tx.voucher.findUniqueOrThrow({where:{id:voucherId}});
    if (current.status !== "PENDING_FINANCE") throw new Error("Voucher not found or already resolved");
    const reference = paymentReference?.trim() || current.reference?.trim();
    if (!reference) throw new Error("Enter the payment reference after payment before approving this voucher");
    const method = current.side === "BUY" ? paymentDetails?.method?.trim() || current.method : current.method;
    const bankName = current.side === "BUY" ? (method === "Bank transfer" ? paymentDetails?.bankName?.trim() || current.bankName : null) : current.bankName;
    if (current.side === "BUY" && !["Bank transfer", "Cheque", "Cash", "Other"].includes(method ?? "")) throw new Error("Select the payment method used by Finance");
    if (method === "Bank transfer" && !bankName) throw new Error("Select the bank used for payment");
    const candidates = await tx.voucher.findMany({where:{id:{not:voucherId},status:"APPROVED"}});
    if (candidates.some(v => vouchersSharePaymentKey({...current,reference,bankName},v))) throw new Error("This payment reference, bank, date and amount are already approved");
    const updated = await tx.voucher.updateMany({
      where: { id: voucherId, status: "PENDING_FINANCE" },
      data: {
        status: "APPROVED",
        reference,
        method,
        bankName,
        resolvedByName: approvedByName,
        resolvedAt: new Date(),
        resolutionNote: note?.trim() || null,
      },
    });
    if (updated.count === 0) {
      throw new Error("Voucher not found or already resolved");
    }
    const row = await tx.voucher.findUnique({ where: { id: voucherId } });
    if (row?.builtyNumber && row.tradeRef) await advanceTrade(row.tradeRef, tx);
    await postCreditForVoucher(
      {
        voucherId: row!.id,
        voucherNo: row!.voucherNo,
        counterpartyId: row!.counterpartyId,
        amountPkr: num(row!.amountPkr),
        side: row!.side,
        tradeRef: row!.tradeRef,
        note: row!.noteRef
          ? `Settles ${row!.noteRef}${row!.note ? ` — ${row!.note}` : ""}`
          : row!.note,
      },
      tx,
    );
    if (row?.builtyNumber) await tx.counterpartyLedgerEntry.updateMany({ where: { voucherId }, data: { purchaseAdvanceFlow: true } });
    // Close the note only once the internal sub-ledger is within tolerance.
    if (row!.noteRef) {
      const { remainingPkr } = await noteBalance(row!.noteRef, row!.counterpartyId, tx);
      if (noteShouldClose(remainingPkr)) {
        await markSettlementNotePaid(
          {
            counterpartyId: row!.counterpartyId,
            noteRef: row!.noteRef,
            voucherNo: row!.voucherNo,
          },
          tx,
        );
      }
    }
  });
  const fresh = await prisma.voucher.findUnique({
    where: { id: voucherId },
    include: VOUCHER_INCLUDE,
  });
  // The credit just landed — if it completes a settled trade's amount, that
  // trade closes now. A note voucher is exempt: its trade is already cancelled
  // or closed, and its money answers to the note, not to a settlement invoice.
  if (fresh?.tradeRef && !fresh.noteRef) {
    const { syncSettlementCollection } = await import("@/server/settlement-billing");
    await syncSettlementCollection(fresh.tradeRef, approvedByName);
  }
  return voucherRowToView(fresh!);
}

export async function rejectVoucher(
  voucherId: string,
  rejectedByName: string,
  note?: string,
): Promise<VoucherView> {
  const reason = note?.trim();
  if (!reason) throw new Error("A rejection reason is required");
  const updated = await prisma.voucher.updateMany({
    where: { id: voucherId, status: "PENDING_FINANCE" },
    data: {
      status: "REJECTED",
      resolvedByName: rejectedByName,
      resolvedAt: new Date(),
      resolutionNote: reason,
    },
  });
  if (updated.count === 0) {
    throw new Error("Voucher not found or already resolved");
  }
  const row = await prisma.voucher.findUnique({
    where: { id: voucherId },
    include: VOUCHER_INCLUDE,
  });
  const { recordRejection } = await import("@/server/rejections");
  await recordRejection({
    kind: "VOUCHER",
    refLabel: row!.voucherNo,
    voucherNo: row!.voucherNo,
    counterpartyName: row!.counterparty.name,
    amountPkr: num(row!.amountPkr),
    rejectedBy: rejectedByName,
    rejectedRole: "FINANCE",
    reason,
  });
  return voucherRowToView(row!);
}
