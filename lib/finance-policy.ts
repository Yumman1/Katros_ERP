/**
 * Finance policy knobs — shared types + pure helpers. The single policy row
 * (Finance → Policies page) drives the 236G advance income tax and the yearly
 * counterparty inflow limit everywhere in the app.
 */

export type FinancePolicyView = {
  /** Yearly inflow cap per buyer (PKR actually received, fiscal year 1 Jul – 30 Jun). */
  yearlyInflowLimitPkr: number;
  /** 236G advance income tax rate for ATL filers — percent of (price × quantity) on sales. */
  advanceTaxRatePct: number;
  /** 236G advance income tax rate for non-filers. */
  advanceTaxRatePctNonFiler: number;
  updatedAt: Date | null;
  updatedBy: string | null;
};

export const DEFAULT_FINANCE_POLICY: FinancePolicyView = {
  yearlyInflowLimitPkr: 200_000_000,
  advanceTaxRatePct: 0.1,
  advanceTaxRatePctNonFiler: 2.0,
  updatedAt: null,
  updatedBy: null,
};

/** 236G rate for a counterparty by ATL filer status. */
export function advanceTaxRateFor(
  policy: Pick<FinancePolicyView, "advanceTaxRatePct" | "advanceTaxRatePctNonFiler">,
  filerStatus: "FILER" | "NON_FILER" | null | undefined,
): number {
  return filerStatus === "NON_FILER" ? policy.advanceTaxRatePctNonFiler : policy.advanceTaxRatePct;
}

/** 236G advance income tax on a sale amount (PKR), rounded to the paisa. */
export function advanceTaxOn(amountPkr: number, ratePct: number): number {
  if (!Number.isFinite(amountPkr) || amountPkr <= 0) return 0;
  return Math.round(amountPkr * (ratePct / 100) * 100) / 100;
}

/**
 * Fiscal year window containing `date` — Pakistani fiscal year, 1 July to
 * 30 June. The ledger's yearly inflow tally recalibrates on 30 June.
 */
export function fiscalYearRange(date: Date = new Date()): { start: Date; end: Date } {
  const y = date.getUTCFullYear();
  const startYear = date.getUTCMonth() >= 6 ? y : y - 1; // months 0-11; July = 6
  return {
    start: new Date(Date.UTC(startYear, 6, 1)),
    end: new Date(Date.UTC(startYear + 1, 6, 1)),
  };
}

/** Label like "FY 2025-26" for a fiscal-year window. */
export function fiscalYearLabel(date: Date = new Date()): string {
  const { start } = fiscalYearRange(date);
  const startYear = start.getUTCFullYear();
  return `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

// ─── Ledger aging ─────────────────────────────────────────────────────────────

export const AGING_BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  current: "Current",
  "1-30": "1–30 days",
  "31-60": "31–60 days",
  "61-90": "61–90 days",
  "90+": "90+ days",
};

/**
 * Aging bucket for a receivable: days past its due date (arrival + credit
 * days). Entries with no due date, or not yet due, are "current".
 */
export function agingBucketFor(dueDate: Date | null | undefined, asOf: Date = new Date()): AgingBucket {
  if (!dueDate) return "current";
  const overdueDays = Math.floor((asOf.getTime() - new Date(dueDate).getTime()) / 86_400_000);
  if (overdueDays <= 0) return "current";
  if (overdueDays <= 30) return "1-30";
  if (overdueDays <= 60) return "31-60";
  if (overdueDays <= 90) return "61-90";
  return "90+";
}
