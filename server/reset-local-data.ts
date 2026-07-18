import fs from "fs";
import path from "path";
import superjson from "superjson";
import {
  EXECUTION_FILE,
  localDataPath,
  MASTER_DATA_FILE,
  TRADES_FILE,
} from "@/server/local-persist";
import { MARKET_PRICES_FILE } from "@/server/market-prices";

const CHANGE_REQUESTS_FILE = "change-requests.json";
const EXECUTION_LOGS_FILE = "execution-logs.json";

export function emptyBookedTradesSnapshot() {
  return { mockTradeSeq: 10_000, bookedTrades: [] };
}

export function emptyExecutionSnapshot() {
  return {
    contracts: [] as [string, unknown][],
    inboundReceipts: [] as unknown[],
    outboundDispatches: [] as unknown[],
    spotEvents: [] as [string, unknown][],
    paymentRequests: [] as unknown[],
    pendingTrucks: [] as unknown[],
    inboundSeq: 0,
    outboundSeq: 0,
    paymentSeq: 0,
    truckSeq: 0,
  };
}

export function emptyMasterDataSnapshot() {
  return {
    customCommodities: [],
    customGrades: {},
    customLocations: [],
    customCounterparties: [],
    customCommoditySeq: 0,
    customLocationSeq: 0,
    customCounterpartySeq: 0,
    customQuantityUnits: [] as string[],
    warehouseOverrides: {},
  };
}

export function emptyChangeRequestsSnapshot() {
  return { requests: [], seq: 0 };
}

export function emptyMarketPricesSnapshot() {
  return { prices: {} };
}

/** Wipe all locally persisted CTRM data (trades, execution, master custom rows, etc.). */
export function resetAllLocalData(): { cleared: string[] } {
  const dir = path.dirname(localDataPath(TRADES_FILE));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const payloads: Record<string, unknown> = {
    [TRADES_FILE]: emptyBookedTradesSnapshot(),
    [EXECUTION_FILE]: emptyExecutionSnapshot(),
    [MASTER_DATA_FILE]: emptyMasterDataSnapshot(),
    [CHANGE_REQUESTS_FILE]: emptyChangeRequestsSnapshot(),
    [MARKET_PRICES_FILE]: emptyMarketPricesSnapshot(),
    [EXECUTION_LOGS_FILE]: { executionLogs: [] },
  };

  const cleared: string[] = [];
  for (const [file, data] of Object.entries(payloads)) {
    const filePath = localDataPath(file);
    const tmp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, superjson.stringify(data), "utf8");
    fs.renameSync(tmp, filePath);
    cleared.push(file);
  }

  return { cleared };
}
