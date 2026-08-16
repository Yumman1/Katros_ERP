import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import { COUNTER } from "@/server/db/counters";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * One place a counter's numbers can already be sitting.
 *
 * A counter is not the authority on what has been issued — the tables are.
 * Bulk loads and restores bring their own reference numbers and leave the
 * counter behind them, so every allocation reconciles against these sources
 * before handing out a number.
 */
export type SerialSource = {
  table: string;
  column: string;
  /**
   * Only rows matching this POSIX pattern belong to this counter's namespace.
   *
   * Filtering by shape first is what keeps two formats sharing one table apart.
   * Stripping digits blindly reads `CP-00103` and the legacy bare code `100402`
   * as the same series and jumps the counter by a hundred thousand.
   */
  pattern: string;
  /** SQL yielding the numeric part; defaults to the digits of `column`. */
  valueExpr?: string;
  /** Extra predicate, for counters that own only part of a table. */
  where?: string;
  /** Difference between the counter and the printed number, if any. */
  offset?: number;
};

export type SerialSpec = {
  counter: string;
  sources: SerialSource[];
  format: (seq: number) => string;
};

function digitsOf(column: string) {
  return `NULLIF(regexp_replace("${column}", '\\D', '', 'g'), '')::bigint`;
}

/** `SELECT <max sequence already issued>` for one source, or NULL if none. */
function sourceMaxSql(source: SerialSource): Prisma.Sql {
  const value = source.valueExpr ?? digitsOf(source.column);
  // Inlined rather than bound: an untyped parameter next to a bigint leaves
  // Postgres to guess the operand type.
  const offset = Prisma.raw(String(Math.trunc(source.offset ?? 0)));
  const filters = [Prisma.sql`"${Prisma.raw(source.column)}" ~ ${source.pattern}`];
  if (source.where) filters.push(Prisma.raw(source.where));
  return Prisma.sql`
    SELECT MAX(${Prisma.raw(value)}) - ${offset} AS m
    FROM "${Prisma.raw(source.table)}"
    WHERE ${Prisma.join(filters, " AND ")}
  `;
}

/** The next free sequence across every source, as a scalar subquery. */
function nextFreeSql(spec: SerialSpec): Prisma.Sql {
  const union = Prisma.join(
    spec.sources.map(sourceMaxSql),
    " UNION ALL ",
  );
  // GREATEST(…, 0) guards a legacy reference numbered below its offset, which
  // would otherwise drive the counter negative.
  return Prisma.sql`(SELECT GREATEST(COALESCE(MAX(m), 0), 0) + 1 FROM (${union}) s(m))`;
}

/**
 * Claim the next sequence for a counter, reconciled against the references
 * already in the data.
 *
 * A single INSERT … ON CONFLICT … RETURNING, so concurrent callers are
 * serialized by Postgres on the counter row and can never be handed the same
 * number — the same guarantee the plain counter gives, with drift removed.
 */
export async function nextSerialSeq(spec: SerialSpec, db: Db = prisma): Promise<number> {
  const nextFree = nextFreeSql(spec);
  const rows = await db.$queryRaw<Array<{ value: bigint }>>`
    INSERT INTO "RefCounter" ("name", "value")
    VALUES (${spec.counter}, ${nextFree})
    ON CONFLICT ("name") DO UPDATE SET "value" = GREATEST(
      "RefCounter"."value" + 1,
      ${nextFree}
    )
    RETURNING "value"
  `;
  return Number(rows[0]!.value);
}

/** Claim the next sequence and render it in the counter's own format. */
export async function nextSerial(spec: SerialSpec, db: Db = prisma): Promise<string> {
  return spec.format(await nextSerialSeq(spec, db));
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Allocate a reference and create the row, retrying if the reference turns out
 * to be taken.
 *
 * Reconciliation already makes a collision all but unreachable; this is the
 * backstop that turns the remaining sliver into a second attempt rather than a
 * failed truck assignment.
 *
 * Not for use inside a transaction — a unique violation aborts the surrounding
 * transaction, so nothing can be retried on it. Callers already in one should
 * use `nextSerial(spec, tx)`, where reconciliation alone is the protection.
 */
export async function allocateSerial<T>(
  spec: SerialSpec,
  create: (ref: string) => Promise<T>,
  attempts = 5,
): Promise<T> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const ref = await nextSerial(spec);
    try {
      return await create(ref);
    } catch (err) {
      if (attempt === attempts || !isUniqueViolation(err)) throw err;
    }
  }
  throw new Error(`Could not allocate a free ${spec.counter} reference`);
}

/** Highest sequence already issued across a counter's sources. Read-only. */
export async function serialMaxInUse(spec: SerialSpec, db: Db = prisma): Promise<number> {
  const union = Prisma.join(spec.sources.map(sourceMaxSql), " UNION ALL ");
  const rows = await db.$queryRaw<Array<{ m: bigint | null }>>`
    SELECT GREATEST(COALESCE(MAX(m), 0), 0) AS m FROM (${union}) s(m)
  `;
  return Number(rows[0]?.m ?? 0);
}

/** Current stored value of a counter, without touching it. Read-only. */
export async function serialCounterValue(name: string, db: Db = prisma): Promise<number> {
  const rows = await db.$queryRaw<Array<{ value: bigint }>>`
    SELECT "value" FROM "RefCounter" WHERE "name" = ${name}
  `;
  return Number(rows[0]?.value ?? 0);
}

const pad = (seq: number, width: number) => String(seq).padStart(width, "0");

/**
 * Every counter-backed reference in the system, with the places its numbers
 * live. Adding a reference format means adding it here — that is what keeps the
 * allocator and the integrity check reading the same definition.
 */
export const SERIALS = {
  /** Inbound receipt KCS numbers. Shifted stock keeps its KCS on the transfer. */
  INBOUND: {
    counter: COUNTER.INBOUND,
    sources: [
      { table: "InboundReceipt", column: "kcsNo", pattern: "^KCS-[0-9]+$" },
      { table: "StockTransfer", column: "inGatepassNo", pattern: "^KCS-[0-9]+$" },
    ],
    format: (seq) => `KCS-${seq}`,
  },
  /** Inbound gatepasses, issued to gate entries and to received transfers. */
  GATEPASS_INBOUND: {
    counter: COUNTER.TRUCK_INBOUND,
    sources: [
      {
        table: "PendingTruck",
        column: "gatepassNo",
        pattern: "^GP-IN-[0-9]+$",
        where: `"movementType" = 'INBOUND'`,
      },
      { table: "StockTransfer", column: "inGatepassNo", pattern: "^GP-IN-[0-9]+$" },
    ],
    format: (seq) => `GP-IN-${pad(seq, 4)}`,
  },
  /** Outbound gatepasses, issued to gate entries and to dispatched transfers. */
  GATEPASS_OUTBOUND: {
    counter: COUNTER.TRUCK_OUTBOUND,
    sources: [
      {
        table: "PendingTruck",
        column: "gatepassNo",
        pattern: "^GP-OUT-[0-9]+$",
        where: `"movementType" = 'OUTBOUND'`,
      },
      { table: "StockTransfer", column: "outGatepassNo", pattern: "^GP-OUT-[0-9]+$" },
    ],
    format: (seq) => `GP-OUT-${pad(seq, 4)}`,
  },
  /** Trade refs carry the booking year, but the sequence never restarts. */
  TRADE: {
    counter: COUNTER.TRADE,
    sources: [
      {
        table: "Trade",
        column: "tradeRef",
        pattern: "^KAS-[0-9]+-[0-9]+$",
        valueExpr: `NULLIF(split_part("tradeRef", '-', 3), '')::bigint`,
      },
    ],
    format: (seq) => `KAS-${new Date().getFullYear()}-${seq}`,
  },
  PAYMENT: {
    counter: COUNTER.PAYMENT,
    sources: [{ table: "PaymentRequest", column: "requestRef", pattern: "^pay-[0-9]+$" }],
    format: (seq) => `pay-${seq}`,
  },
  VOUCHER: {
    counter: COUNTER.VOUCHER,
    sources: [{ table: "Voucher", column: "voucherNo", pattern: "^VCH-[0-9]+$" }],
    format: (seq) => `VCH-${pad(seq, 5)}`,
  },
  DELIVERY_ORDER: {
    counter: COUNTER.DELIVERY_ORDER,
    sources: [{ table: "PendingTruck", column: "deliveryOrderNo", pattern: "^DO-[0-9]+$" }],
    format: (seq) => `DO-${pad(seq, 5)}`,
  },
  GATE_OUT_SLIP: {
    counter: COUNTER.GATE_OUT_SLIP,
    sources: [{ table: "PendingTruck", column: "gateOutSlipNo", pattern: "^GOS-[0-9]+$" }],
    format: (seq) => `GOS-${pad(seq, 5)}`,
  },
  SETTLEMENT_INVOICE: {
    counter: COUNTER.SETTLEMENT_INVOICE,
    sources: [{ table: "Invoice", column: "invoiceRef", pattern: "^SIN-[0-9]+$" }],
    format: (seq) => `SIN-${pad(seq, 5)}`,
  },
  STOCK_TRANSFER: {
    counter: COUNTER.STOCK_TRANSFER,
    sources: [{ table: "StockTransfer", column: "transferRef", pattern: "^SHF-[0-9]+$" }],
    format: (seq) => `SHF-${pad(seq, 5)}`,
  },
  CHANGE_REQUEST: {
    counter: COUNTER.CHANGE_REQUEST,
    sources: [{ table: "ChangeRequest", column: "id", pattern: "^CR-[0-9]+$" }],
    format: (seq) => `CR-${pad(seq, 4)}`,
  },
  /**
   * Debit and credit notes draw on one counter, so a DN and a CN never carry
   * the same number — the pattern has to admit both prefixes.
   */
  CANCELLATION_NOTE: {
    counter: COUNTER.CANCELLATION_NOTE,
    sources: [
      {
        table: "CounterpartyLedgerEntry",
        column: "sourceRef",
        pattern: "^(DN|CN)-[0-9]+$",
      },
    ],
    format: (seq) => `DN-${pad(seq, 5)}`,
  },
  /**
   * Counterparty codes start at CP-00101, so the printed number runs 100 ahead
   * of the counter. Legacy bare-numeric codes are a separate namespace the
   * pattern deliberately excludes.
   */
  COUNTERPARTY: {
    counter: COUNTER.COUNTERPARTY,
    sources: [
      { table: "Counterparty", column: "code", pattern: "^CP-[0-9]+$", offset: 100 },
    ],
    format: (seq) => `CP-${pad(seq + 100, 5)}`,
  },
  WAREHOUSE: {
    counter: COUNTER.WAREHOUSE,
    sources: [{ table: "Location", column: "code", pattern: "^K[0-9]+$" }],
    format: (seq) => `K${pad(seq, 3)}`,
  },
} satisfies Record<string, SerialSpec>;

/** Cancellation notes print as DN or CN off the same sequence. */
export function formatNoteRef(kind: "DN" | "CN", seq: number): string {
  return `${kind}-${pad(seq, 5)}`;
}
