-- FZCO third-party stock is pooled by holder and grade, regardless of location.
-- Preserve legacy location text; retain date/currency validation.
ALTER TABLE "SesameExportShipment" DROP CONSTRAINT "direct_dispatch_location_check";
ALTER TABLE "SesameExportShipment" ADD CONSTRAINT "direct_dispatch_details_check"
 CHECK (NOT "directThirdParty" OR ("movementDate" IS NOT NULL AND "quotedCurrency"='USD'));
