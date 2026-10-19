import { prisma } from "@/server/db";
import { nextSerial, SERIALS } from "@/server/db/serials";
import { isSesameCommodity } from "@/lib/sesame";
import { ENTITY_NAMES, internalPakSale, tradeEntity, type SesameEntity } from "@/lib/sesame-entity";
import { entityCounterparty } from "./internal-payments";
import { assertTripartyPakistanPayment } from "./triparty-pakistan-payment";

const n = (v: unknown) => Number(v ?? 0);
const money = (v: number) => Math.round(v * 100) / 100;

export async function internationalPurchaseTrades(code: string, entity: SesameEntity, counterpartyId: string) {
  const cp = await prisma.counterparty.findUniqueOrThrow({ where: { id: counterpartyId } });
  const trades = await prisma.trade.findMany({
    where: {
      commodity: { code },
      tradeStatus: { in: ["LOCKED", "CONFIRMED", "EXECUTED"] },
      contract: { is: { contractStatus: "Open" } },
    },
    include: { commodity: true, counterparty: true, contract: true },
  });
  return trades.flatMap((t) => {
    if (!isSesameCommodity(t.commodity.code)) return [];
    const internal = internalPakSale(t.commodity.code, t.direction, t.tradeParams);
    const own = tradeEntity(t.tradeParams);
    const fx = n((t.tradeParams as Record<string, unknown> | null)?.executionFxPkrPerUsd);
    const amountPkr = n(t.quantity) * 1000 * n(t.contract?.ratePerKg);
    if (internal && entity === "FZCO" && cp.code === "INTERCO-PAK") {
      return [{
        tradeRef: t.tradeRef,
        counterpartyId: cp.id,
        counterparty: ENTITY_NAMES.PAK,
        currency: t.currency,
        fxRate: fx,
        openMt: n(t.contract?.openQtyMt ?? t.quantity),
        amountPkr,
        internal: true,
      }];
    }
    if (!internal && own === entity && t.direction === "BUY" && t.counterpartyId === counterpartyId && t.tradeScope === "INTERNATIONAL") {
      return [{
        tradeRef: t.tradeRef,
        counterpartyId: t.counterpartyId,
        counterparty: t.counterparty.name,
        currency: t.currency,
        fxRate: fx,
        openMt: n(t.contract?.openQtyMt ?? t.quantity),
        amountPkr,
        internal: false,
      }];
    }
    return [];
  });
}

export async function internationalPurchaseBls(tradeRef: string) {
  const rows = await prisma.sesameExportShipment.findMany({
    where: { OR: [{ tradeRef }, { fzcoSaleTradeRef: tradeRef },{sourcePurchaseTradeRef:tradeRef}], status: "BL_RECORDED", blNo: { not: null } },
    include: { vouchers: true, fzcoSaleTrade: { select: { tradeRef: true } } },
    orderBy: { blRecordedAt: "desc" },
  });
  return rows.map((s) => {
    const purchaseAmount=n(s.sourcePurchaseTradeRef?s.supplierAmountPkr:s.amountPkr);
    const purchasePaid = s.vouchers.filter((v) => v.side === "BUY" && v.status !== "REJECTED").reduce((a, v) => a + n(v.amountPkr), 0);
    const salePaid = s.vouchers.filter((v) => v.side === "SELL" && v.status === "APPROVED").reduce((a, v) => a + n(v.amountPkr), 0);
    return {
      id: s.id,
      blNo: s.blNo!,
      tradeRef: s.sourcePurchaseTradeRef??s.tradeRef,
      fzcoSaleTradeRef: s.fzcoSaleTradeRef,
      triparty: s.triparty,
      amountPkr: purchaseAmount,
      fzcoAmountPkr: n(s.fzcoAmountPkr),
      fxRate: n(s.sourcePurchaseTradeRef?s.supplierFxRate:s.fxRate),
      outstandingPkr: money(Math.max(0, purchaseAmount - purchasePaid)),
      buyerPaidPkr: money(salePaid),
      buyerPaid: salePaid > 0.005,
      payablePkr: money(Math.max(0, Math.min(purchaseAmount - purchasePaid, (s.triparty?salePaid-purchasePaid:purchaseAmount-purchasePaid)))),
    };
  });
}

export async function createInternationalPurchase(input: {
  counterpartyId: string;
  tradeRef: string;
  exportShipmentId?: string | null;
  amount: number;
  voucherDate: Date;
  note?: string | null;
  entity: SesameEntity;
  actor: string;
  userId: string;
  code: string;
}) {
  return prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`purchase-payment:${input.tradeRef}`}))::text`;
    const t = await db.trade.findUniqueOrThrow({ where: { tradeRef: input.tradeRef }, include: { commodity: true, contract: true } });
    if (!isSesameCommodity(t.commodity.code) || t.commodity.code !== input.code) throw new Error("Select a Sesame trade on this desk");
    if(!t.contract||!["LOCKED","CONFIRMED","EXECUTED"].includes(t.tradeStatus))throw new Error("Select a locked purchase trade");
    const internal = internalPakSale(t.commodity.code, t.direction, t.tradeParams);
    if (internal && input.entity !== "FZCO") throw new Error("Dubai FZCO pays Kastros Pakistan on the internal sale");
    if (internal && !input.exportShipmentId) throw new Error("Select the BL. FZCO can pay Kastros Pakistan only after the buyer has paid Dubai FZCO");
    if (!internal && (tradeEntity(t.tradeParams) !== input.entity || t.direction !== "BUY")) throw new Error("Select an open international purchase");
    const fx = n((t.tradeParams as Record<string, unknown> | null)?.executionFxPkrPerUsd);
    const amountPkr = t.currency === "USD" ? money(input.amount * (fx > 0 ? fx : 0)) : money(input.amount);
    if (t.currency === "USD" && fx <= 0) throw new Error("Lock a USD / PKR exchange rate on the trade first");
    if (!(amountPkr > 0)) throw new Error("Enter a positive amount");

    const existing=await db.voucher.aggregate({where:{tradeRef:t.tradeRef,side:'BUY',executionEntity:input.entity,status:{not:'REJECTED'}},_sum:{amountPkr:true}});
    if(amountPkr+n(existing._sum.amountPkr)>n(t.quantity)*1000*n(t.contract.ratePerKg)+.005)throw new Error('Payment exceeds the purchase balance including pending vouchers');
    let counterpartyId = input.counterpartyId;
    if (internal) {
      const pak = await entityCounterparty(db, "PAK", input.userId);
      if (pak.id !== input.counterpartyId && input.counterpartyId !== t.counterpartyId) {
        const selected = await db.counterparty.findUnique({ where: { id: input.counterpartyId } });
        if (selected?.code !== "INTERCO-PAK") throw new Error("Pay Kastros Pakistan on this internal trade");
      }
      counterpartyId = pak.id;
    } else if (t.counterpartyId !== input.counterpartyId) {
      throw new Error("Trade does not belong to this counterparty");
    }

    const shipment = input.exportShipmentId
      ? await db.sesameExportShipment.findUniqueOrThrow({ where: { id: input.exportShipmentId }, include: { vouchers: true } })
      : null;
    if (shipment) {
      if (shipment.status !== "BL_RECORDED" || !shipment.blNo) throw new Error("Record the BL before paying against it");
      if (shipment.tradeRef !== t.tradeRef && shipment.fzcoSaleTradeRef !== t.tradeRef && shipment.sourcePurchaseTradeRef !==t.tradeRef) throw new Error("BL does not belong to this trade");
      const committed = shipment.vouchers.filter((v) => v.side === "BUY" && v.status !== "REJECTED").reduce((a, v) => a + n(v.amountPkr), 0);
      if (amountPkr > n(shipment.sourcePurchaseTradeRef?shipment.supplierAmountPkr:shipment.amountPkr) - committed + 0.005) throw new Error("Payment exceeds the remaining BL balance including pending vouchers");
    }
    if (internal) await assertTripartyPakistanPayment(db, { tradeRef: t.tradeRef, amountPkr });

    const voucherNo = await nextSerial(SERIALS.VOUCHER, db);
    await db.voucher.create({
      data: {
        voucherNo,
        voucherKind: "INTL_PURCHASE",
        voucherDate: input.voucherDate,
        counterpartyId,
        tradeRef: t.tradeRef,
        exportShipmentId: shipment?.id ?? null,
        commodityCode: t.commodity.code,
        executionEntity: input.entity,
        side: "BUY",
        amountPkr,
        paymentFxRate: fx > 0 ? fx : null,
        note: [shipment ? `BL ${shipment.blNo}` : null, input.note?.trim()].filter(Boolean).join(" · ") || null,
        enteredByName: input.actor,
      },
    });
    return { voucherNo };
  });
}
