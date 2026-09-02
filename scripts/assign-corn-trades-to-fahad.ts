/**
 * Assign all Corn trades to Fahad Ahmed (fahad.ahmed@kastros.co).
 *   npx tsx scripts/assign-corn-trades-to-fahad.ts
 *   npx tsx scripts/assign-corn-trades-to-fahad.ts --apply
 */
import "./load-env";
process.env.MOCK_MODE = "false";
if (!process.env.POSTGRES_PRISMA_URL && process.env.DATABASE_URL) {
  process.env.POSTGRES_PRISMA_URL = process.env.DATABASE_URL;
}

import { prisma } from "@/server/db";
import { CORN_TRADER_EMAIL } from "./lib/corn-trader";

const APPLY = process.argv.includes("--apply");

async function main(): Promise<void> {
  const trader = await prisma.user.findFirst({
    where: { email: { equals: CORN_TRADER_EMAIL, mode: "insensitive" } },
    select: { id: true, name: true, email: true },
  });
  if (!trader?.name) {
    throw new Error(`User not found or missing name: ${CORN_TRADER_EMAIL}`);
  }

  const cornCommodity = await prisma.commodity.findFirst({
    where: { code: "CORN" },
    select: { id: true },
  });

  const tradeWhere = {
    OR: [
      { tradeRef: { startsWith: "Kas-Cor26-", mode: "insensitive" as const } },
      ...(cornCommodity ? [{ commodityId: cornCommodity.id }] : []),
    ],
  };

  const trades = await prisma.trade.findMany({
    where: tradeWhere,
    select: { tradeRef: true, traderName: true },
    orderBy: { tradeRef: "asc" },
  });

  const needsUpdate = trades.filter((t) => t.traderName !== trader.name);
  console.log(`Corn trader: ${trader.name} <${trader.email}>`);
  console.log(`Corn trades total: ${trades.length}, need traderName update: ${needsUpdate.length}`);

  if (!APPLY) {
    console.log("\nDry run. Pass --apply to update Trade + ExecutionContract.");
    if (needsUpdate.length > 0) {
      console.log("Sample refs:", needsUpdate.slice(0, 10).map((t) => t.tradeRef).join(", "));
    }
    return;
  }

  const updatedTrades = await prisma.trade.updateMany({
    where: tradeWhere,
    data: { traderName: trader.name, createdById: trader.id },
  });

  const contracts = await prisma.executionContract.updateMany({
    where: { tradeRef: { in: trades.map((t) => t.tradeRef) } },
    data: { traderName: trader.name },
  });

  console.log(`Updated ${updatedTrades.count} trades, ${contracts.count} execution contracts.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
