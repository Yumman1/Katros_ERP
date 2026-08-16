-- Settlement notes were all posted as DEBIT regardless of direction. On a buy
-- account a debit note (seller owes us) is a receivable and belongs on the
-- credit side; on a sell account a credit note (we owe the buyer) belongs on
-- the credit side too. Balance = credit − debit must reflect that.

UPDATE "CounterpartyLedgerEntry"
SET "entryType" = 'CREDIT'
WHERE "sourceType" = 'ADJUSTMENT'
  AND side = 'BUY'
  AND "sourceRef" ~ '^DN-'
  AND "entryType" = 'DEBIT';

UPDATE "CounterpartyLedgerEntry"
SET "entryType" = 'CREDIT'
WHERE "sourceType" = 'ADJUSTMENT'
  AND side = 'SELL'
  AND "sourceRef" ~ '^CN-'
  AND "entryType" = 'DEBIT';
