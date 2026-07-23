import { prisma } from "@/server/db";
import { num } from "@/server/db/convert";
import {
  DEFAULT_FINANCE_POLICY,
  fiscalYearRange,
  type FinancePolicyView,
} from "@/lib/finance-policy";

const POLICY_ID = "main";

type PolicyRow = NonNullable<Awaited<ReturnType<typeof prisma.financePolicy.findUnique>>>;

function rowToView(row: PolicyRow): FinancePolicyView {
  return {
    yearlyInflowLimitPkr: num(row.yearlyInflowLimitPkr),
    advanceTaxRatePct: num(row.advanceTaxRatePct),
    advanceTaxRatePctNonFiler: num(row.advanceTaxRatePctNonFiler),
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

/** The single company-wide finance policy row (created on first read). */
export async function getFinancePolicy(): Promise<FinancePolicyView> {
  const row =
    (await prisma.financePolicy.findUnique({ where: { id: POLICY_ID } })) ??
    (await prisma.financePolicy.upsert({
      where: { id: POLICY_ID },
      update: {},
      create: { id: POLICY_ID },
    }));
  return rowToView(row);
}

export async function updateFinancePolicy(
  patch: {
    yearlyInflowLimitPkr?: number;
    advanceTaxRatePct?: number;
    advanceTaxRatePctNonFiler?: number;
  },
  updatedBy: string,
): Promise<FinancePolicyView> {
  if (patch.yearlyInflowLimitPkr != null && patch.yearlyInflowLimitPkr <= 0) {
    throw new Error("Yearly inflow limit must be positive");
  }
  for (const rate of [patch.advanceTaxRatePct, patch.advanceTaxRatePctNonFiler]) {
    if (rate != null && (rate < 0 || rate > 100)) {
      throw new Error("Advance tax rates must be between 0 and 100 percent");
    }
  }
  const row = await prisma.financePolicy.upsert({
    where: { id: POLICY_ID },
    update: { ...patch, updatedBy },
    create: {
      id: POLICY_ID,
      yearlyInflowLimitPkr:
        patch.yearlyInflowLimitPkr ?? DEFAULT_FINANCE_POLICY.yearlyInflowLimitPkr,
      advanceTaxRatePct: patch.advanceTaxRatePct ?? DEFAULT_FINANCE_POLICY.advanceTaxRatePct,
      advanceTaxRatePctNonFiler:
        patch.advanceTaxRatePctNonFiler ?? DEFAULT_FINANCE_POLICY.advanceTaxRatePctNonFiler,
      updatedBy,
    },
  });
  return rowToView(row);
}

/**
 * Fiscal-year money ACTUALLY RECEIVED per buyer (PKR) — the sum of
 * finance-approved voucher credits on each counterparty's sell ledger in the
 * current fiscal year. Powers the "Caution: over limit" tag in the booking
 * dropdown; recalibrates every 30 June.
 */
export async function getYearlySellInflowByCounterparty(): Promise<Map<string, number>> {
  const { start, end } = fiscalYearRange();
  const grouped = await prisma.counterpartyLedgerEntry.groupBy({
    by: ["counterpartyId"],
    where: {
      side: "SELL",
      entryType: "CREDIT",
      entryDate: { gte: start, lt: end },
    },
    _sum: { amountPkr: true },
  });
  return new Map(grouped.map((g) => [g.counterpartyId, num(g._sum.amountPkr ?? 0)]));
}
