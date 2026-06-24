import type { ExecutionProfile } from "@/lib/trade-constants";
import { KG_PER_MAUND } from "@/lib/trade-constants";

export type FifoContractCandidate = {
  tradeRef: string;
  contractDate: Date;
  openQtyMt: number;
  executionProfile: ExecutionProfile;
  direction: "BUY" | "SELL";
};

export function kgToMt(kg: number) {
  return kg / 1000;
}

export function mtToKg(mt: number) {
  return mt * 1000;
}

export function maundToKg(maund: number) {
  return maund * KG_PER_MAUND;
}

export function sortFifoContracts<T extends FifoContractCandidate>(contracts: T[]): T[] {
  return [...contracts].sort((a, b) => a.contractDate.getTime() - b.contractDate.getTime());
}

export function suggestFifoAllocation(
  contracts: FifoContractCandidate[],
  qtyMt: number,
  profileFilter?: ExecutionProfile,
  direction?: "BUY" | "SELL",
): { tradeRef: string; allocateMt: number }[] {
  let pool = contracts.filter((c) => c.openQtyMt > 0.001);
  if (profileFilter) pool = pool.filter((c) => c.executionProfile === profileFilter);
  if (direction) pool = pool.filter((c) => c.direction === direction);
  pool = sortFifoContracts(pool);

  let remaining = qtyMt;
  const out: { tradeRef: string; allocateMt: number }[] = [];
  for (const c of pool) {
    if (remaining <= 0) break;
    const take = Math.min(c.openQtyMt, remaining);
    if (take > 0) {
      out.push({ tradeRef: c.tradeRef, allocateMt: take });
      remaining -= take;
    }
  }
  return out;
}
