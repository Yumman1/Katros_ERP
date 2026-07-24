import { KG_PER_MAUND } from "@/lib/trade-constants";
import { advanceTaxOn, advanceTaxRateFor } from "@/lib/finance-policy";
import { prisma } from "@/server/db";
import { num, numOrNull } from "@/server/db/convert";
import { getFinancePolicy } from "@/server/finance/policy";
import { updateTruckLedgerDebitAmount } from "@/server/finance/ledger";
import { inboundNetInvoiceWeightKg, revalidateGateInvoiceStage } from "./trucks";

/**
 * Dynamic recompute after a trade's price changes (trader or execution edit):
 * every linked truck's expected amounts are re-derived from the CURRENT
 * contract rate — buy-side expected invoices (and their wrong-invoicing
 * validation) and sell-side receivables (incl. 236G) plus their ledger
 * debits. Paid / settled trucks are left untouched.
 */
export async function recomputeTradeLinkedAmounts(tradeRef: string): Promise<void> {
  const ref = tradeRef.trim();
  const [trade, contract, policy] = await Promise.all([
    prisma.trade.findUnique({
      where: { tradeRef: ref },
      select: {
        direction: true,
        counterparty: { select: { taxFilerStatus: true } },
      },
    }),
    prisma.executionContract.findUnique({
      where: { tradeRef: ref },
      select: { ratePerKg: true, ratePerMaund: true },
    }),
    getFinancePolicy(),
  ]);
  if (!trade) return;
  const rateKg =
    numOrNull(contract?.ratePerKg) ?? (numOrNull(contract?.ratePerMaund) ?? 0) / KG_PER_MAUND;
  if (!(rateKg > 0)) return;

  const trucks = await prisma.pendingTruck.findMany({
    where: {
      OR: [{ assignedTradeRef: ref }, { gateInvoiceTradeRef: ref }],
    },
  });

  for (const truck of trucks) {
    if (truck.movementType === "INBOUND") {
      // Approved / trader-held invoices are locked — never recompute them.
      if (
        truck.gateInvoiceStage === "PAYMENT_APPROVED" ||
        truck.gateInvoiceStage === "HOLD_OLD_DUES"
      ) {
        continue;
      }
      const netKg = inboundNetInvoiceWeightKg(
        numOrNull(truck.warehouseWeightKg),
        numOrNull(truck.totalDeductionsKg),
      );
      if (netKg == null) continue;
      const expectedPkr = Math.round(netKg * rateKg * 100) / 100;
      const stage = truck.gateInvoiceNo
        ? revalidateGateInvoiceStage({
            gateInvoiceAmount: numOrNull(truck.gateInvoiceAmount),
            gateInvoiceExpectedPkr: expectedPkr,
            gateInvoiceStage: truck.gateInvoiceStage,
          })
        : null;
      await prisma.pendingTruck.update({
        where: { id: truck.id },
        data: {
          gateInvoiceExpectedPkr: expectedPkr,
          gateInvoiceRatePerKg: rateKg,
          ...(truck.gateInvoiceNo ? { gateInvoiceStage: stage } : {}),
        },
      });
      await updateTruckLedgerDebitAmount(truck.id, expectedPkr);
    } else {
      // Amounts freeze the moment a truck enters an approval pipeline or is
      // paid/settled/released — a price edit must never change what the
      // trader/CEO approved or what a released buyer owes. Only trucks still
      // awaiting balance re-derive.
      if (truck.saleStage !== "AWAITING_BALANCE") continue;
      const dispatchedKg = Math.max(0, num(truck.weightKg) - num(truck.remainingKg));
      if (!(dispatchedKg > 0)) continue;
      const saleBasePkr = Math.round(dispatchedKg * rateKg * 100) / 100;
      const taxRatePct = advanceTaxRateFor(policy, trade.counterparty?.taxFilerStatus);
      const saleTaxPkr = advanceTaxOn(saleBasePkr, taxRatePct);
      const saleExpectedPkr = Math.round((saleBasePkr + saleTaxPkr) * 100) / 100;
      await prisma.pendingTruck.update({
        where: { id: truck.id },
        data: { saleBasePkr, saleTaxPkr, saleExpectedPkr },
      });
      await updateTruckLedgerDebitAmount(truck.id, saleExpectedPkr);
    }
  }
}
