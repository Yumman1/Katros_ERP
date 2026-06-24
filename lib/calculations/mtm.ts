import type { TradeDirection } from "@prisma/client";

export type MTMResult = {
  mtmPnl: number;
  unrealizedPnl: number;
  bookValue: number;
  marketValue: number;
};

/** MTM for physical commodity trades (quantity × price). */
export function calculateMTM(
  quantity: number,
  bookPrice: number,
  marketPrice: number,
  direction: TradeDirection,
): MTMResult {
  const bookValue = quantity * bookPrice;
  const marketValue = quantity * marketPrice;
  const mtmPnl =
    direction === "BUY" ? marketValue - bookValue : bookValue - marketValue;
  return {
    mtmPnl,
    unrealizedPnl: mtmPnl,
    bookValue,
    marketValue,
  };
}
