-- A triparty BL posts three ledger rows against one shipment
ALTER TABLE "CounterpartyLedgerEntry" DROP CONSTRAINT IF EXISTS "CounterpartyLedgerEntry_exportShipmentId_key";
DROP INDEX IF EXISTS "CounterpartyLedgerEntry_exportShipmentId_key";
CREATE INDEX IF NOT EXISTS "CounterpartyLedgerEntry_exportShipmentId_idx" ON "CounterpartyLedgerEntry"("exportShipmentId");

-- FZCO → buyer invoice fixed at BL
ALTER TABLE "SesameExportShipment" ADD COLUMN "fzcoAmountPkr" DECIMAL(20,2);
ALTER TABLE "SesameExportShipment" ADD COLUMN "fzcoFxRate" DECIMAL(20,8);
