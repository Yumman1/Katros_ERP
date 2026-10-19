import type { Prisma } from "@prisma/client";
import { internalPakSale } from "@/lib/sesame-entity";

const n = (v: unknown) => Number(v ?? 0);
const money = (v: number) => Math.round(v * 100) / 100;

export const TRIPARTY_PAK_BEFORE_BUYER =
  "The buyer must pay Dubai FZCO first. FZCO cannot pay Kastros Pakistan until that receipt is approved.";

export function tripartyPakistanOverpayMessage(buyerPaidPkr: number) {
  return `FZCO can pay Kastros Pakistan only up to what the buyer has already paid Dubai FZCO (${buyerPaidPkr.toLocaleString("en-PK")} PKR).`;
}

type ShipmentSlice = {
  triparty: boolean;
  status: string;
  vouchers: { id?: string; side: string; status: string; amountPkr: unknown }[];
};

/** Pure rule: FZCO may pay Pakistan only after, and only up to, approved buyer receipts. */
export function tripartyPakistanPaymentError(input: {
  amountPkr: number;
  shipments: ShipmentSlice[];
  otherPakPaymentsPkr?: number;
  excludeVoucherId?: string;
}): string | null {
  const recorded = input.shipments.filter((s) => s.triparty && s.status === "BL_RECORDED");
  const buyerPaid = money(
    recorded.reduce(
      (sum, s) =>
        sum +
        s.vouchers
          .filter((v) => v.side === "SELL" && v.status === "APPROVED")
          .reduce((a, v) => a + n(v.amountPkr), 0),
      0,
    ),
  );
  const pakCommitted = money(
    recorded.reduce(
      (sum, s) =>
        sum +
        s.vouchers
          .filter(
            (v) =>
              v.side === "BUY" &&
              v.status !== "REJECTED" &&
              (!input.excludeVoucherId || v.id !== input.excludeVoucherId),
          )
          .reduce((a, v) => a + n(v.amountPkr), 0),
      0,
    ) + n(input.otherPakPaymentsPkr),
  );
  if (buyerPaid <= 0.005) return TRIPARTY_PAK_BEFORE_BUYER;
  if (input.amountPkr + pakCommitted > buyerPaid + 0.005) return tripartyPakistanOverpayMessage(buyerPaid);
  return null;
}

/** Blocks a Kastros Pakistan payment voucher on a triparty internal sale until the buyer has paid FZCO. */
export async function assertTripartyPakistanPayment(
  db: Prisma.TransactionClient,
  input: { tradeRef: string; amountPkr: number; excludeVoucherId?: string },
) {
  const trade = await db.trade.findUniqueOrThrow({
    where: { tradeRef: input.tradeRef },
    include: { commodity: true },
  });
  if (!internalPakSale(trade.commodity.code, trade.direction, trade.tradeParams)) return;
  const shipments = await db.sesameExportShipment.findMany({
    where: { tradeRef: input.tradeRef, triparty: true, status: { not: "REJECTED" } },
    include: { vouchers: true },
  });
  const extra = await db.voucher.findMany({
    where: {
      tradeRef: input.tradeRef,
      side: "BUY",
      status: { not: "REJECTED" },
      exportShipmentId: null,
      ...(input.excludeVoucherId ? { id: { not: input.excludeVoucherId } } : {}),
    },
  });
  const message = tripartyPakistanPaymentError({
    amountPkr: input.amountPkr,
    shipments,
    otherPakPaymentsPkr: extra.reduce((a, v) => a + n(v.amountPkr), 0),
    excludeVoucherId: input.excludeVoucherId,
  });
  if (message) throw new Error(message);
}
