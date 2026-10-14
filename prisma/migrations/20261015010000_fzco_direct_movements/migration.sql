ALTER TABLE "SesameExportShipment" ADD COLUMN "directThirdParty" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "dispatchLocation" TEXT,
ADD COLUMN "movementDate" TIMESTAMP(3),
ADD COLUMN "documentLinks" JSONB NOT NULL DEFAULT '[]';
DROP INDEX "export_open_group";
CREATE UNIQUE INDEX "export_open_group" ON "SesameExportShipment"("tradeRef","warehouseName","directThirdParty") WHERE status='DRAFT';
ALTER TABLE "SesameExportShipment" ADD CONSTRAINT "direct_dispatch_location_check" CHECK (NOT "directThirdParty" OR ("dispatchLocation" IS NOT NULL AND length(trim("dispatchLocation")) > 0 AND "movementDate" IS NOT NULL AND "quotedCurrency"='USD'));
