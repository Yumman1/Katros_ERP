import { prisma } from "@/server/db";
import { num } from "@/server/db/convert";

export const FX_RATE_ID = "USD_PKR";

export type DeskFxRateRow = {
  rate: number;
  updatedAt: string;
  updatedBy: string | null;
};

/** Latest desk USD/PKR — null when never set. */
export async function getUsdPkrRate(): Promise<DeskFxRateRow | null> {
  const row = await prisma.deskFxRate.findUnique({ where: { id: FX_RATE_ID } });
  if (!row) return null;
  const rate = num(row.rate);
  if (!(rate > 0)) return null;
  return {
    rate,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

export async function setUsdPkrRate(rate: number, updatedBy?: string): Promise<DeskFxRateRow> {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("FX rate must be a positive number (PKR per 1 USD)");
  }
  const row = await prisma.deskFxRate.upsert({
    where: { id: FX_RATE_ID },
    create: { id: FX_RATE_ID, rate, updatedBy: updatedBy ?? null },
    update: { rate, updatedBy: updatedBy ?? null },
  });
  return {
    rate: num(row.rate),
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

/** PKR ÷ rate → USD; returns null when FX is not configured. */
export async function pkrToUsd(pkr: number): Promise<number | null> {
  const fx = await getUsdPkrRate();
  if (!fx) return null;
  return pkr / fx.rate;
}
