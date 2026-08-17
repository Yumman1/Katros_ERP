/** Default quantity tolerance (MT) when none was set at booking. */
export const DEFAULT_QUANTITY_TOLERANCE_MT = 10;

/** @deprecated use DEFAULT_QUANTITY_TOLERANCE_MT */
export const AUTO_CLOSE_THRESHOLD_MT = DEFAULT_QUANTITY_TOLERANCE_MT;

export function parseQuantityToleranceMt(
  contractualQtyMt: number,
  quantityUnit: string,
  tradeParams?: Record<string, string | number | null> | null,
): number {
  void quantityUnit;
  const fromParams = tradeParams?.quantityTolerance;
  const label =
    (typeof fromParams === "string" ? fromParams : null) ??
    (typeof tradeParams?.tolerancePct === "string" ? tradeParams.tolerancePct : null);

  if (label) {
    const qtyMatch = label.match(/\+?\/?-?\s*([\d.]+)\s*(MT|KG|MAUND|T|TON|TONNE)/i);
    if (qtyMatch) {
      const n = Number(qtyMatch[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    const pctMatch = label.match(/([\d.]+)\s*%/);
    if (pctMatch) {
      const pct = Number(pctMatch[1]);
      if (Number.isFinite(pct) && pct > 0) return (contractualQtyMt * pct) / 100;
    }
  }

  const mode = tradeParams?.quantityToleranceMode;
  const raw = tradeParams?.quantityToleranceValue;
  if (raw != null && raw !== "") {
    const n = typeof raw === "number" ? raw : Number(String(raw));
    if (Number.isFinite(n) && n > 0) {
      if (mode === "quantity") return n;
      return (contractualQtyMt * n) / 100;
    }
  }

  return DEFAULT_QUANTITY_TOLERANCE_MT;
}

/** Contract qty + booked tolerance — auto-close triggers above this level. */
export function autoCloseThresholdQty(contractualQtyMt: number, toleranceMt: number): number {
  return contractualQtyMt + toleranceMt;
}

/**
 * Contract qty − booked tolerance — the free-close floor. At or above it the
 * delivery is within tolerance and the trader closes without CEO approval;
 * below it a close is short and goes to the CEO.
 */
export function freeCloseFloorQty(contractualQtyMt: number, toleranceMt: number): number {
  return Math.max(0, contractualQtyMt - toleranceMt);
}

/**
 * Auto-close only when received qty exceeds contract + booked tolerance (e.g. 300 MT + 10 MT → closes above 310 MT).
 * All other cases require manual close from the trader fulfillment page (CEO approval).
 */
export function shouldAutoCloseContract(input: {
  contractualQtyMt: number;
  receivedQtyMt: number;
  toleranceMt: number;
}): boolean {
  const { contractualQtyMt, receivedQtyMt, toleranceMt } = input;
  return receivedQtyMt > autoCloseThresholdQty(contractualQtyMt, toleranceMt);
}

/** Remaining qty a contract can still absorb before hitting contract + tolerance. */
export function contractAbsorbableQtyMt(
  contractualQtyMt: number,
  contractFulfilledMt: number,
  toleranceMt: number,
): number {
  return Math.max(
    0,
    autoCloseThresholdQty(contractualQtyMt, toleranceMt) - contractFulfilledMt,
  );
}

/** Remaining qty assignable at one warehouse, capped by contract-level tolerance headroom. */
export function warehouseAbsorbableQtyMt(input: {
  contractualQtyMt: number;
  contractFulfilledMt: number;
  whAllocatedMt: number;
  whFulfilledMt: number;
  toleranceMt: number;
}): number {
  const contractHeadroom = contractAbsorbableQtyMt(
    input.contractualQtyMt,
    input.contractFulfilledMt,
    input.toleranceMt,
  );
  const whHeadroom = Math.max(
    0,
    input.whAllocatedMt + input.toleranceMt - input.whFulfilledMt,
  );
  return Math.min(contractHeadroom, whHeadroom);
}
