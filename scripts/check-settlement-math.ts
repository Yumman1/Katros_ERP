/**
 * Settlement money math — pure checks, no database needed.
 * Covers the two rules the whole flow rests on: what a settled trade is worth,
 * and how money gathered in the ledger lands on its invoices.
 */
import { Prisma } from "@prisma/client";
import {
  allocateCollected,
  settlementCovered,
  settlementTargetPkr,
} from "@/server/settlement-billing";

const D = (n: number) => new Prisma.Decimal(n);
const past = new Date(Date.now() - 86_400_000);
const future = new Date(Date.now() + 86_400_000);

const checks: Array<[string, boolean, string]> = [];
const expect = (label: string, ok: boolean, detail: string) => checks.push([label, ok, detail]);

async function main() {
  // ── Target: 236G on sales only ──
  const buy = await settlementTargetPkr({
    direction: "BUY",
    quantity: D(100),
    price: D(1000),
    pricePerCanonicalQty: null,
    counterparty: { taxFilerStatus: "NON_FILER" },
  });
  expect(
    "purchase settles at bare notional — no 236G even for a non-filer",
    buy.targetPkr === 100_000 && buy.advanceTaxPkr === 0,
    `target ${buy.targetPkr}, tax ${buy.advanceTaxPkr}`,
  );

  const canonical = await settlementTargetPkr({
    direction: "BUY",
    quantity: D(50),
    price: D(999),
    pricePerCanonicalQty: D(2000), // canonical price wins over the entered one
    counterparty: null,
  });
  expect(
    "canonical price is used when present",
    canonical.targetPkr === 100_000,
    `target ${canonical.targetPkr}`,
  );

  // ── Allocation: oldest invoice first ──
  const invs = [
    { ref: "SIN-1", amountPkr: 60_000, dueDate: future },
    { ref: "SIN-2", amountPkr: 40_000, dueDate: future },
  ];

  const none = allocateCollected(invs, 0);
  expect(
    "nothing collected → both awaiting payment",
    none.every((a) => a.paidPkr === 0 && a.status === "SENT"),
    none.map((a) => a.status).join("/"),
  );

  const partial = allocateCollected(invs, 60_000);
  expect(
    "first invoice paid in full before the second gets anything",
    partial[0]!.status === "PAID" &&
      partial[0]!.outstandingPkr === 0 &&
      partial[1]!.paidPkr === 0 &&
      partial[1]!.outstandingPkr === 40_000,
    `${partial[0]!.status} / ${partial[1]!.status}, outstanding ${partial[1]!.outstandingPkr}`,
  );

  const straddle = allocateCollected(invs, 75_000);
  expect(
    "money straddling two invoices part-pays the second",
    straddle[1]!.status === "PARTIALLY_PAID" &&
      straddle[1]!.paidPkr === 15_000 &&
      straddle[1]!.outstandingPkr === 25_000,
    `inv2 paid ${straddle[1]!.paidPkr}, outstanding ${straddle[1]!.outstandingPkr}`,
  );

  const full = allocateCollected(invs, 100_000);
  expect(
    "full amount → every invoice paid, nothing outstanding",
    full.every((a) => a.status === "PAID" && a.outstandingPkr === 0),
    full.map((a) => a.status).join("/"),
  );

  const over = allocateCollected(invs, 250_000);
  expect(
    "over-payment never allocates more than an invoice is worth",
    over[0]!.paidPkr === 60_000 && over[1]!.paidPkr === 40_000,
    `${over[0]!.paidPkr} + ${over[1]!.paidPkr}`,
  );

  const overdue = allocateCollected([{ ref: "SIN-9", amountPkr: 10_000, dueDate: past }], 0);
  expect(
    "unpaid invoice past its due date reads overdue",
    overdue[0]!.status === "OVERDUE",
    overdue[0]!.status,
  );

  const paidLate = allocateCollected([{ ref: "SIN-9", amountPkr: 10_000, dueDate: past }], 10_000);
  expect("a paid invoice is never overdue", paidLate[0]!.status === "PAID", paidLate[0]!.status);

  // ── Closure threshold ──
  expect(
    "closes when collected equals the target",
    settlementCovered(100_000, 100_000),
    "100k/100k",
  );
  expect("does not close one rupee short", !settlementCovered(99_999, 100_000), "99,999/100,000");
  expect(
    "sub-paisa rounding still closes",
    settlementCovered(99_999.999, 100_000),
    "99,999.999/100,000",
  );
  expect("a zero-value trade never auto-closes", !settlementCovered(0, 0), "0/0");

  // ── Partial inbound payment: releasing part and holding the rest ──
  // Mirrors traderResolveGateInvoice's split across a truck's receipts.
  const release = (
    receipts: Array<{ due: number; paid: number }>,
    amount: number,
  ): number[] => {
    let left = amount;
    return receipts.map((r) => {
      const owed = Math.max(0, r.due - r.paid);
      if (left <= 0.005 || owed <= 0.005) return 0;
      const take = Math.round(Math.min(owed, left) * 100) / 100;
      left = Math.round((left - take) * 100) / 100;
      return take;
    });
  };

  const oneTruck = release([{ due: 1_000_000, paid: 0 }], 600_000);
  expect(
    "a partial release asks finance for only the released amount",
    oneTruck[0] === 600_000,
    `requested ${oneTruck[0]?.toLocaleString("en-PK")}`,
  );

  const second = release([{ due: 1_000_000, paid: 600_000 }], 250_000);
  expect(
    "a later release draws against what is still owed",
    second[0] === 250_000,
    `requested ${second[0]?.toLocaleString("en-PK")} of 400,000 owed`,
  );

  const finish = release([{ due: 1_000_000, paid: 850_000 }], 150_000);
  expect(
    "the final release clears the remainder exactly",
    finish[0] === 150_000 && 850_000 + finish[0]! === 1_000_000,
    `850,000 + ${finish[0]?.toLocaleString("en-PK")} = 1,000,000`,
  );

  const spread = release(
    [
      { due: 400_000, paid: 0 },
      { due: 600_000, paid: 0 },
    ],
    500_000,
  );
  expect(
    "a release spanning two receipts fills the oldest first",
    spread[0] === 400_000 && spread[1] === 100_000,
    `${spread[0]?.toLocaleString("en-PK")} + ${spread[1]?.toLocaleString("en-PK")}`,
  );

  const capped = release([{ due: 1_000_000, paid: 900_000 }], 500_000);
  expect(
    "a release never draws more than a receipt still owes",
    capped[0] === 100_000,
    `capped at ${capped[0]?.toLocaleString("en-PK")}`,
  );

  const settledAlready = release([{ due: 1_000_000, paid: 1_000_000 }], 50_000);
  expect(
    "a fully paid receipt takes nothing further",
    settledAlready[0] === 0,
    `took ${settledAlready[0]}`,
  );

  console.log("");
  for (const [label, ok, detail] of checks) {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}\n        ${detail}`);
  }
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(`\n  ${checks.length - failed}/${checks.length} checks passed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
