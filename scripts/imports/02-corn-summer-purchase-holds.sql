-- Corn Summer Purchase import — payment holds, per truck.
--
-- The workbook records a hold as one phrase against a whole gate invoice
-- ("1.1M hold / Remain released"), but an invoice covers several trucks and the
-- money model holds against a truck: each PendingTruck carries its own stage and
-- note, and each InboundReceipt its own paidAmountPkr. A group phrase therefore
-- has to be split before it can be stored — the 1.1M on Corn001 is 1.1M across
-- five trucks, not 1.1M on each.
--
-- Every hold below is split pro rata by truck invoice value, so the shares add
-- back to the workbook figure exactly:
--
--   Corn001  Cotton and cotton  5 trucks  4,914,782.07  hold 1,100,000.00
--   18       Mhar Trader        2 trucks  2,219,062.50  hold 1,000,000.00
--   21       PerfectHANDS       2 trucks  2,535,356.25  hold 50% of each truck
--   6        SSA Commission     1 truck   1,391,292.50  hold in full
--   21       IDREES AND SONS    2 trucks  2,940,045.63  hold in full
--
-- Shares are written out literally rather than recomputed here: they are the
-- audited numbers, and a rounding rule that drifts by a rupee would silently
-- stop the parts adding up to the whole.
--
-- Idempotent — re-running sets the same absolute values, never accumulates.

BEGIN;

WITH hold(gatepass_no, paid_pkr, hold_note) AS (
  VALUES
    -- Kas-Cor26-0065 · Cotton and cotton · gate invoice Corn001
    -- PKR 1,100,000 held across the five trucks; remainder released.
    ('GP-IN-0385', 861640.60::numeric,
     '1.1M hold on invoice Corn001 (5 trucks) — this truck holds PKR 248,455.78, remainder released'),
    ('GP-IN-0386', 929621.29::numeric,
     '1.1M hold on invoice Corn001 (5 trucks) — this truck holds PKR 268,058.15, remainder released'),
    ('GP-IN-0387', 1012587.79::numeric,
     '1.1M hold on invoice Corn001 (5 trucks) — this truck holds PKR 291,981.71, remainder released'),
    ('GP-IN-0388', 115965.79::numeric,
     '1.1M hold on invoice Corn001 (5 trucks) — this truck holds PKR 33,438.96, remainder released'),
    ('GP-IN-0389', 894966.60::numeric,
     '1.1M hold on invoice Corn001 (5 trucks) — this truck holds PKR 258,065.40, remainder released'),

    -- Kas-Cor26-0066 · Mhar Trader · gate invoice 18
    -- PKR 1,000,000 held across the two trucks; remainder released.
    ('GP-IN-0392', 635797.49::numeric,
     '1M hold on invoice 18 (2 trucks) — this truck holds PKR 521,546.26, remainder released'),
    ('GP-IN-0393', 583265.01::numeric,
     '1M hold on invoice 18 (2 trucks) — this truck holds PKR 478,453.74, remainder released'),

    -- Kas-Cor26-0058 · PerfectHANDS · gate invoice 21
    -- Half of each truck held — already per truck in the workbook.
    ('GP-IN-0364', 666665.625::numeric, '50% hold — half of this truck released'),
    ('GP-IN-0365', 601012.50::numeric,  '50% hold — half of this truck released'),

    -- Held in full, nothing released.
    ('GP-IN-0280', 0::numeric, 'Hold'),  -- Kas-Cor26-0045 · SSA Commission · invoice 6
    ('GP-IN-0405', 0::numeric, 'Hold'),  -- Kas-Cor26-0069 · IDREES AND SONS · invoice 21
    ('GP-IN-0406', 0::numeric, 'Hold')   -- Kas-Cor26-0069 · IDREES AND SONS · invoice 21
),

-- A receipt is PAID only once the paid total covers what is due, PARTIALLY_PAID
-- while some of it is out, and back to ALLOCATED when the whole truck is held.
receipts AS (
  UPDATE "InboundReceipt" r
  SET "paidAmountPkr" = h.paid_pkr,
      status = CASE
        WHEN h.paid_pkr >= r."amountDue" - 0.005 THEN 'PAID'::"InboundReceiptStatus"
        WHEN h.paid_pkr > 0.005                  THEN 'PARTIALLY_PAID'::"InboundReceiptStatus"
        ELSE 'ALLOCATED'::"InboundReceiptStatus"
      END
  FROM hold h
  WHERE r."gatepassNo" = h.gatepass_no
  RETURNING r."gatepassNo"
)

-- A truck with money still out stays in the trader's queue at PARTIAL_PAYMENT;
-- one held end to end is HOLD_OLD_DUES.
UPDATE "PendingTruck" t
SET "gateInvoiceStage" = CASE
      WHEN h.paid_pkr > 0.005 THEN 'PARTIAL_PAYMENT'::"GateInvoiceStage"
      ELSE 'HOLD_OLD_DUES'::"GateInvoiceStage"
    END,
    "gateInvoiceHoldNote" = h.hold_note
FROM hold h
WHERE t."gatepassNo" = h.gatepass_no;

COMMIT;

-- Verification — held per gate invoice must equal the workbook figure:
--   SELECT t."counterpartyName", t."gateInvoiceNo", COUNT(*) AS trucks,
--          SUM(r."amountDue")                        AS invoice_total,
--          SUM(r."paidAmountPkr")                    AS released,
--          SUM(r."amountDue" - r."paidAmountPkr")    AS held
--   FROM "PendingTruck" t
--   JOIN "InboundReceipt" r ON r."gatepassNo" = t."gatepassNo"
--   WHERE t."gateInvoiceStage" IN ('PARTIAL_PAYMENT','HOLD_OLD_DUES')
--   GROUP BY 1, 2;
