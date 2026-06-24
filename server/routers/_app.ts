import { router } from "@/server/trpc/trpc";
import { positionsRouter } from "./positions";
import { mtmRouter } from "./mtm";
import { pnlRouter } from "./pnl";
import { cashflowRouter } from "./cashflow";
import { reconciliationRouter } from "./reconciliation";
import { inventoryRouter } from "./inventory";
import { reportsRouter } from "./reports";
import { traceabilityRouter } from "./traceability";
import { commodityRouter } from "./commodity";
import { supplyChainRouter } from "./supply-chain";
import { shipmentsRouter } from "./shipments";
import { traderRouter } from "./trader";
import { executionRouter } from "./execution";
import { financeRouter } from "./finance";

export const appRouter = router({
  positions: positionsRouter,
  mtm: mtmRouter,
  pnl: pnlRouter,
  cashflow: cashflowRouter,
  reconciliation: reconciliationRouter,
  inventory: inventoryRouter,
  reports: reportsRouter,
  traceability: traceabilityRouter,
  commodity: commodityRouter,
  supplyChain: supplyChainRouter,
  shipments: shipmentsRouter,
  trader: traderRouter,
  execution: executionRouter,
  finance: financeRouter,
});

export type AppRouter = typeof appRouter;
