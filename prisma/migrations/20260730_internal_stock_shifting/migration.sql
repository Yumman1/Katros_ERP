-- Internal warehouse-to-warehouse stock shifting.
--
-- A shift moves grain we already own between our own warehouses. It has no
-- trade, no counterparty money and no ledger entry, so it cannot be stored as
-- an InboundReceipt/OutboundDispatch pair — both require a tradeRef and read
-- their commodity from the contract behind it. StockTransfer carries its own
-- commodity instead.

-- The party a shift gatepass is booked against: us.
ALTER TYPE "CounterpartyType" ADD VALUE IF NOT EXISTS 'INTERNAL';

DO $$ BEGIN
  CREATE TYPE "StockTransferStatus" AS ENUM ('DRAFT', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "StockTransfer" (
  "id"                TEXT NOT NULL,
  "transferRef"       TEXT NOT NULL,
  "commodityCode"     TEXT NOT NULL,
  "commodityName"     TEXT NOT NULL,
  "fromWarehouseName" TEXT,
  "toWarehouseName"   TEXT NOT NULL,
  "externalOrigin"    TEXT,
  "dispatchedQtyMt"   DECIMAL(20,6) NOT NULL,
  "receivedQtyMt"     DECIMAL(20,6),
  "truckNo"           TEXT NOT NULL,
  "driverName"        TEXT,
  "driverPhone"       TEXT,
  "biltyNo"           TEXT,
  "bags"              INTEGER,
  "outGatepassNo"     TEXT,
  "inGatepassNo"      TEXT,
  "status"            "StockTransferStatus" NOT NULL DEFAULT 'DRAFT',
  "reason"            TEXT,
  "remarks"           TEXT,
  "createdByName"     TEXT,
  "dispatchedAt"      TIMESTAMP(3),
  "receivedAt"        TIMESTAMP(3),
  "cancelledAt"       TIMESTAMP(3),
  "cancelReason"      TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StockTransfer_transferRef_key"   ON "StockTransfer"("transferRef");
CREATE UNIQUE INDEX IF NOT EXISTS "StockTransfer_outGatepassNo_key" ON "StockTransfer"("outGatepassNo");
CREATE UNIQUE INDEX IF NOT EXISTS "StockTransfer_inGatepassNo_key"  ON "StockTransfer"("inGatepassNo");
CREATE INDEX IF NOT EXISTS "StockTransfer_to_commodity_idx"   ON "StockTransfer"("toWarehouseName", "commodityCode");
CREATE INDEX IF NOT EXISTS "StockTransfer_from_commodity_idx" ON "StockTransfer"("fromWarehouseName", "commodityCode");
CREATE INDEX IF NOT EXISTS "StockTransfer_status_idx"         ON "StockTransfer"("status");

-- RLS on, no policies — the app reaches Postgres only through Prisma on the
-- server, so a leaked anon key still reads nothing (mirrors every other table).
ALTER TABLE "StockTransfer" ENABLE ROW LEVEL SECURITY;
