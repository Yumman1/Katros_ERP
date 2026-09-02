import { CORN_TRADER_EMAIL } from "@/lib/trader-identity";

/** Corn desk trades are owned by Fahad Ahmed for trader UI visibility. */
export { CORN_TRADER_EMAIL };

export const CORN_TRADER_USER_ID_SQL = `(SELECT id FROM "User" WHERE lower(email) = lower('${CORN_TRADER_EMAIL}') LIMIT 1)`;

export const CORN_TRADER_NAME_SQL = `(SELECT name FROM "User" WHERE lower(email) = lower('${CORN_TRADER_EMAIL}') LIMIT 1)`;

/** SQL fragment: trade belongs to Corn Summer/Winter book. */
export const CORN_TRADE_WHERE_SQL = `(
  t."tradeRef" ILIKE 'Kas-Cor26-%'
  OR (
    t.direction IN ('BUY', 'SELL')
    AND EXISTS (
      SELECT 1 FROM "Commodity" c
      WHERE c.id = t."commodityId" AND c.code = 'CORN'
    )
  )
)`;
