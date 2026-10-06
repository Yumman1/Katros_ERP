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

export function pakistanDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Karachi",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
}
export function processingForecast(records: {productionDate:string;inputKg:number;outputKg:number;impuritiesKg:number}[], remainingKg:number, capacityKg:number, expectedYield:number, today=pakistanDate()) {
  const cutoff = new Date(today+"T00:00:00Z"); cutoff.setUTCDate(cutoff.getUTCDate()-89);
  const recent=records.filter(r=>r.productionDate>=cutoff.toISOString().slice(0,10)&&r.productionDate<=today);
  const input=recent.reduce((s,r)=>s+r.inputKg,0), output=recent.reduce((s,r)=>s+r.outputKg,0);
  const first=recent.map(r=>r.productionDate).sort()[0];
  const elapsed=first?Math.max(1,Math.round((Date.parse(today)-Date.parse(first))/86400000)+1):0;
  const dailyKg=elapsed?input/elapsed:capacityKg;
  const yieldRatio=input>0?output/input:expectedYield;
  const forecastInputKg=Math.min(remainingKg,dailyKg*90);
  return {dailyKg,yieldRatio,basis:elapsed?"Recorded calendar-day average":"Planned capacity and yield",daysRemaining:dailyKg>0?Math.ceil(remainingKg/dailyKg):null,forecastInputKg,forecastOutputKg:forecastInputKg*yieldRatio,forecastImpuritiesKg:forecastInputKg*(1-yieldRatio)};
}
