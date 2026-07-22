import { prisma } from "@/server/db";
import { num } from "@/server/db/convert";
import {
  DEFAULT_FINANCE_POLICY,
  fiscalYearRange,
  type FinancePolicyView,
} from "@/lib/finance-policy";

const POLICY_ID = "main";

/** The single company-wide finance policy row (created on first read). */
export async function getFinancePolicy(): Promise<FinancePolicyView> {
  const row =
    (await prisma.financePolicy.findUnique({ where: { id: POLICY_ID } })) ??
    (await prisma.financePolicy.upsert({
      where: { id: POLICY_ID },
      update: {},
      create: { id: POLICY_ID },
    }));
  return {
    yearlyInflowLimitPkr: num(row.yearlyInflowLimitPkr),
    advanceTaxRatePct: num(row.advanceTaxRatePct),
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

export async function updateFinancePolicy(
  patch: { yearlyInflowLimitPkr?: number; advanceTaxRatePct?: number },
  updatedBy: string,
): Promise<FinancePolicyView> {
  if (patch.yearlyInflowLimitPkr != null && patch.yearlyInflowLimitPkr <= 0) {
    throw new Error("Yearly inflow limit must be positive");
  }
  if (
    patch.advanceTaxRatePct != null &&
    (patch.advanceTaxRatePct < 0 || patch.advanceTaxRatePct > 100)
  ) {
    throw new Error("Advance tax rate must be between 0 and 100 percent");
  }
  const row = await prisma.financePolicy.upsert({
    where: { id: POLICY_ID },
    update: { ...patch, updatedBy },
    create: {
      id: POLICY_ID,
      yearlyInflowLimitPkr: patch.yearlyInflowLimitPkr ?? DEFAULT_FINANCE_POLICY.yearlyInflowLimitPkr,
      advanceTaxRatePct: patch.advanceTaxRatePct ?? DEFAULT_FINANCE_POLICY.advanceTaxRatePct,
      updatedBy,
    },
  });
  return {
    yearlyInflowLimitPkr: num(row.yearlyInflowLimitPkr),
    advanceTaxRatePct: num(row.advanceTaxRatePct),
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

/**
 * Fiscal-year sale value booked per SELL-side counterparty (PKR, incl. 236G)
 * — powers the "Caution: over limit" tag in the booking dropdown. Resets each
 * 30 June because the window is the Pakistani fiscal year.
 */
export async function getYearlySellInflowByCounterparty(): Promise<Map<string, number>> {
  const { start, end } = fiscalYearRange();
  const policy = await getFinancePolicy();
  const trades = await prisma.trade.findMany({
    where: {
      direction: "SELL",
      tradeDate: { gte: start, lt: end },
      tradeStatus: { not: "CANCELLED" },
    },
    select: {
      counterpartyId: true,
      quantity: true,
      price: true,
      pricePerCanonicalQty: true,
    },
  });
  const byCp = new Map<string, number>();
  for (const t of trades) {
    const notional =
      num(t.quantity) *
      (t.pricePerCanonicalQty != null ? num(t.pricePerCanonicalQty) : num(t.price));
    const withTax = notional * (1 + policy.advanceTaxRatePct / 100);
    byCp.set(t.counterpartyId, (byCp.get(t.counterpartyId) ?? 0) + withTax);
  }
  return byCp;
}
