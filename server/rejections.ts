import { prisma } from "@/server/db";
import { numOrNull } from "@/server/db/convert";
import { traderNamesMatch } from "@/lib/trader-identity";

export type RejectionKind =
  | "SELL_RELEASE_TRADER"
  | "SELL_RELEASE_CEO"
  | "VOUCHER"
  | "PAYMENT"
  | "INBOUND_OVER_TRADER"
  | "INBOUND_OVER_CEO"
  | "TRADE_SETTLEMENT";

export type RejectionView = {
  id: string;
  kind: RejectionKind;
  refLabel: string;
  gatepassNo: string | null;
  voucherNo: string | null;
  tradeRef: string | null;
  counterpartyName: string | null;
  amountPkr: number | null;
  traderName: string | null;
  rejectedBy: string;
  rejectedRole: string;
  reason: string;
  createdAt: Date;
};

/** Record a rejection — every rejection carries a required reason. */
export async function recordRejection(input: {
  kind: RejectionKind;
  refLabel: string;
  gatepassNo?: string | null;
  voucherNo?: string | null;
  tradeRef?: string | null;
  counterpartyName?: string | null;
  amountPkr?: number | null;
  traderName?: string | null;
  rejectedBy: string;
  rejectedRole: string;
  reason: string;
}): Promise<void> {
  const reason = input.reason.trim();
  if (!reason) throw new Error("A rejection reason is required");
  await prisma.rejectionRecord.create({
    data: {
      kind: input.kind,
      refLabel: input.refLabel,
      gatepassNo: input.gatepassNo ?? null,
      voucherNo: input.voucherNo ?? null,
      tradeRef: input.tradeRef ?? null,
      counterpartyName: input.counterpartyName ?? null,
      amountPkr: input.amountPkr ?? null,
      traderName: input.traderName ?? null,
      rejectedBy: input.rejectedBy,
      rejectedRole: input.rejectedRole,
      reason,
    },
  });
}

/**
 * Rejections for a portal's Rejections page — newest first. Traders see only
 * rejections on their own trades; other roles see everything.
 */
export async function listRejections(filter?: {
  traderName?: string;
  limit?: number;
}): Promise<RejectionView[]> {
  const rows = await prisma.rejectionRecord.findMany({
    orderBy: { createdAt: "desc" },
    take: filter?.limit ?? 200,
  });
  const mapped = rows.map((r) => ({
    id: r.id,
    kind: r.kind as RejectionKind,
    refLabel: r.refLabel,
    gatepassNo: r.gatepassNo,
    voucherNo: r.voucherNo,
    tradeRef: r.tradeRef,
    counterpartyName: r.counterpartyName,
    amountPkr: numOrNull(r.amountPkr),
    traderName: r.traderName,
    rejectedBy: r.rejectedBy,
    rejectedRole: r.rejectedRole,
    reason: r.reason,
    createdAt: r.createdAt,
  }));
  if (filter?.traderName) {
    return mapped.filter((r) => r.traderName && traderNamesMatch(r.traderName, filter.traderName!));
  }
  return mapped;
}
