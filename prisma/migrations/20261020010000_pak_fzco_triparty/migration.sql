-- Counterparty registration per Kastros entity
ALTER TABLE "Counterparty" ADD COLUMN "tradingEntities" TEXT[] NOT NULL DEFAULT ARRAY['PAK']::TEXT[];
UPDATE "Counterparty" SET "tradingEntities" = ARRAY['FZCO']::TEXT[] WHERE "code" = 'INTERCO-PAK';
UPDATE "Counterparty" SET "tradingEntities" = ARRAY['PAK']::TEXT[] WHERE "code" = 'INTERCO-FZCO';

-- Payment-based closing for sesame international sales
ALTER TABLE "ExecutionContract" ADD COLUMN "closeOnPayment" BOOLEAN NOT NULL DEFAULT false;

-- International voucher kinds
ALTER TABLE "Voucher" ADD COLUMN "voucherKind" TEXT;
UPDATE "Voucher" SET "voucherKind" = 'INTL_SALE' WHERE "exportShipmentId" IS NOT NULL AND "side" = 'SELL';

-- Triparty shipments: PAK→FZCO internal sale shipped straight to FZCO's buyer
ALTER TABLE "SesameExportShipment" ADD COLUMN "triparty" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SesameExportShipment" ADD COLUMN "fzcoSaleTradeRef" TEXT;
ALTER TABLE "SesameExportShipment" ADD CONSTRAINT "SesameExportShipment_fzcoSaleTradeRef_fkey" FOREIGN KEY ("fzcoSaleTradeRef") REFERENCES "Trade"("tradeRef") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "SesameExportShipment_fzcoSaleTradeRef_idx" ON "SesameExportShipment"("fzcoSaleTradeRef");

ALTER TABLE "SesameExportGateIntake" ADD COLUMN "triparty" BOOLEAN NOT NULL DEFAULT false;
