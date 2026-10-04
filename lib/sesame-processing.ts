export const PROCESSING_ROUTES = [
  { from: "Raw", to: "Machine Cleaned" },
  { from: "Raw", to: "Sortex" },
  { from: "Machine Cleaned", to: "Sortex" },
] as const;
export function processingYield(inputKg: number, yieldRatio: number) {
  if (!Number.isFinite(inputKg) || inputKg <= 0) throw new Error("Input quantity must be greater than zero");
  if (!Number.isFinite(yieldRatio) || yieldRatio < 0 || yieldRatio > 1) throw new Error("Yield must be between 0 and 1 (0.98 = 98%)");
  const input = Math.round(inputKg * 1000) / 1000;
  if (input <= 0) throw new Error("Minimum processing quantity is 0.001 kg");
  const outputKg = Math.round(input * yieldRatio * 1000) / 1000;
  return { inputKg: input, outputKg, impuritiesKg: Math.round((input-outputKg)*1000)/1000 };
}
export const emptyGrades = () => ({ Raw: 0, "Machine Cleaned": 0, Sortex: 0, Impurities: 0 });
export type GradeBalances = ReturnType<typeof emptyGrades>;
export function sesameGrade(params: unknown): keyof GradeBalances {
  const value = (params as { sesameType?: string } | null)?.sesameType;
  return value && Object.hasOwn(emptyGrades(), value) ? value as keyof GradeBalances : "Machine Cleaned";
}
