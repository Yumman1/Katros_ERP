/** Payment terms are stored as the percentage of the selected payment type. */
export function purchaseAdvancePercentage(paymentType: string, params: unknown): number {
  const p = (params ?? {}) as Record<string, unknown>;
  const percentage = Number(p.paymentPercentage ?? 100);
  if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) return 0;
  return paymentType === "ADVANCE_100" ? percentage : paymentType === "AFTER_DELIVERY_100" ? 100 - percentage : 0;
}
export const roundMoney = (amount: number) => Math.round(amount * 100) / 100;
export function advanceAmount(weightKg: number, rateKg: number, percentage: number) {
  return roundMoney(weightKg * rateKg * percentage / 100);
}
