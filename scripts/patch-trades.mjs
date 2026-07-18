import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const filePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server", "dummy-data.ts");
let s = fs.readFileSync(filePath, "utf8");

const start = s.indexOf("export function mockTraderTrades(");
const end = s.indexOf("export function mockTraderTradeByRef");
if (start < 0 || end < 0) {
  console.error("markers not found");
  process.exit(1);
}

const replacement = `export function mockTraderTrades(
  traderName: string,
  filter?: { status?: TradeStatus; bucket?: "DRAFTS" | "CLOSED" },
) {
  syncBookedTradesFromDisk();
  const canonical = canonicalTraderName(traderName);
  let rows = getBookedTrades().filter((t) => traderNamesMatch(t.traderName, canonical));

  if (filter?.bucket === "DRAFTS") {
    rows = rows.filter((t) => t.tradeStatus === TradeStatus.PENDING);
  } else if (filter?.bucket === "CLOSED") {
    rows = rows.filter(
      (t) => t.tradeStatus === TradeStatus.EXECUTED || t.tradeStatus === TradeStatus.SETTLED,
    );
  } else if (filter?.status) {
    rows = rows.filter((t) => t.tradeStatus === filter.status);
  }

  return rows.sort((a, b) => b.tradeDate.getTime() - a.tradeDate.getTime());
}

`;

fs.writeFileSync(filePath, s.slice(0, start) + replacement + s.slice(end));
console.log("fixed mockTraderTrades");
