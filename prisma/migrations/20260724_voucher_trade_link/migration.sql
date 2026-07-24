-- Vouchers can be deposited against a specific sell trade (credit-terms
-- accounting) or as a direct advance. Ledger credit entries inherit the link.

ALTER TABLE "Voucher" ADD COLUMN "tradeRef" TEXT;
CREATE INDEX "Voucher_tradeRef_idx" ON "Voucher"("tradeRef");
