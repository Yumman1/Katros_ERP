/**
 * Business-reference integrity — read-only, safe against production.
 *
 * Run after a bulk import or restore, and in CI. Allocation self-heals, so a
 * counter sitting behind its data is no longer fatal; this is what makes the
 * drift visible instead of silently absorbed, and it catches the problems
 * reconciliation cannot fix on its own — one reference in two tables, and one
 * supplier invoice number billed on two live trades.
 *
 * Deliberately not checked: truckNo. The same vehicle returning is normal.
 */
import "./load-env";
import { prisma } from "@/server/db";
import { SERIALS, serialCounterValue, serialMaxInUse, type SerialSpec } from "@/server/db/serials";

type Check = { label: string; ok: boolean; detail: string };
const checks: Check[] = [];
const report = (label: string, ok: boolean, detail: string) => checks.push({ label, ok, detail });

async function checkCounterDrift() {
  for (const [name, spec] of Object.entries(SERIALS) as Array<[string, SerialSpec]>) {
    const [counter, maxInUse] = await Promise.all([
      serialCounterValue(spec.counter),
      serialMaxInUse(spec),
    ]);
    report(
      `${name} counter covers the references in use`,
      counter >= maxInUse,
      counter >= maxInUse
        ? `counter ${counter}, highest issued ${maxInUse}, next ${spec.format(counter + 1)}`
        : `counter ${counter} trails the highest issued ${maxInUse} — allocation will heal it, ` +
          `but a direct insert bypassing the allocator would collide`,
    );
  }
}

async function checkCrossTableCollisions() {
  const gatepass = await prisma.$queryRaw<Array<{ ref: string; transferRef: string }>>`
    SELECT t."gatepassNo" AS ref, st."transferRef" AS "transferRef"
    FROM "PendingTruck" t
    JOIN "StockTransfer" st
      ON st."inGatepassNo" = t."gatepassNo" OR st."outGatepassNo" = t."gatepassNo"
  `;
  report(
    "no gatepass number belongs to both a gate entry and a transfer",
    gatepass.length === 0,
    gatepass.length
      ? gatepass.map((r) => `${r.ref} also on ${r.transferRef}`).join("; ")
      : "gate entries and transfers draw distinct numbers",
  );

  const kcs = await prisma.$queryRaw<Array<{ ref: string; transferRef: string }>>`
    SELECT ir."kcsNo" AS ref, st."transferRef" AS "transferRef"
    FROM "InboundReceipt" ir
    JOIN "StockTransfer" st ON st."inGatepassNo" = ir."kcsNo"
  `;
  report(
    "no KCS number belongs to both a receipt and a transfer",
    kcs.length === 0,
    kcs.length
      ? kcs.map((r) => `${r.ref} also on ${r.transferRef}`).join("; ")
      : "receipts and transfers draw distinct KCS numbers",
  );
}

async function checkOpenTradeInvoiceReuse() {
  const rows = await prisma.$queryRaw<
    Array<{ counterparty: string; invoice: string; refs: string }>
  >`
    WITH entries AS (
      SELECT
        btrim("counterpartyName") AS counterparty,
        upper(regexp_replace(btrim("gateInvoiceNo"), '\\s+', ' ', 'g')) AS invoice,
        COALESCE("assignedTradeRef", "gateInvoiceTradeRef") AS ref
      FROM "PendingTruck"
      WHERE "gateInvoiceNo" IS NOT NULL AND btrim("gateInvoiceNo") <> ''
    )
    SELECT e.counterparty, e.invoice, string_agg(DISTINCT e.ref, ', ') AS refs
    FROM entries e
    JOIN "Trade" t
      ON t."tradeRef" = e.ref AND t."tradeStatus" NOT IN ('SETTLED', 'CANCELLED')
    WHERE e.ref IS NOT NULL
    GROUP BY e.counterparty, e.invoice
    HAVING COUNT(DISTINCT e.ref) > 1
  `;
  report(
    "no supplier invoice number is billed on two open trades",
    rows.length === 0,
    rows.length
      ? rows.map((r) => `${r.counterparty} invoice ${r.invoice} on ${r.refs}`).join("; ")
      : "each open trade carries its own invoice numbers",
  );
}

async function checkDuplicateValues() {
  const vouchers = await prisma.$queryRaw<Array<{ bank: string; reference: string; n: bigint }>>`
    SELECT
      COALESCE(NULLIF(btrim("bankName"), ''), '') AS bank,
      lower(btrim("reference")) AS reference,
      COUNT(*) AS n
    FROM "Voucher"
    WHERE "reference" IS NOT NULL
      AND btrim("reference") <> ''
      AND "status" IN ('PENDING_FINANCE', 'APPROVED')
    GROUP BY
      COALESCE(NULLIF(btrim("bankName"), ''), ''),
      lower(btrim("reference")),
      ("voucherDate" AT TIME ZONE 'UTC')::date,
      "amountPkr"
    HAVING COUNT(*) > 1
  `;
  report(
    "no duplicate voucher payment keys (bank + reference + date + amount)",
    vouchers.length === 0,
    vouchers.length
      ? vouchers.map((v) => `${v.bank || "(no bank)"} / ${v.reference} x${Number(v.n)}`).join("; ")
      : "each payment slip is unique on bank, reference, date, and amount",
  );

  const locations = await prisma.$queryRaw<Array<{ code: string; n: bigint }>>`
    SELECT lower(btrim("code")) AS code, COUNT(*) AS n
    FROM "Location"
    WHERE "code" IS NOT NULL AND btrim("code") <> ''
    GROUP BY lower(btrim("code"))
    HAVING COUNT(*) > 1
  `;
  report(
    "no warehouse code is shared by two locations",
    locations.length === 0,
    locations.length
      ? locations.map((l) => `${l.code} x${Number(l.n)}`).join("; ")
      : "warehouse codes are unique",
  );
}

async function main() {
  const url = process.env.POSTGRES_PRISMA_URL;
  if (!url || !/^postgres(ql)?:\/\//.test(url)) {
    console.error(
      `\n  POSTGRES_PRISMA_URL ${url ? `is "${url}", not a connection string` : "is not set"}, ` +
        "so there is no database to check.\n" +
        "  Put the Supabase pooled connection string in .env.local and try again.\n" +
        "  Note that `vercel env pull` cannot supply it: the variable is marked\n" +
        "  Sensitive on Vercel, which makes it write-only and pulls as [SENSITIVE].\n" +
        "  Copy it from Supabase: Project Settings > Database > Connection string.\n",
    );
    process.exitCode = 1;
    return;
  }

  await checkCounterDrift();
  await checkCrossTableCollisions();
  await checkOpenTradeInvoiceReuse();
  await checkDuplicateValues();

  console.log("");
  for (const { label, ok, detail } of checks) {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}\n        ${detail}`);
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n  ${checks.length - failed}/${checks.length} checks passed\n`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
