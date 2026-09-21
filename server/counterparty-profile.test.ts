import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { CounterpartyType, type Counterparty, type Prisma, type Role } from "@prisma/client";
import { prisma } from "./db";
import { traderRouter } from "./routers/trader";
import { updateCounterpartyProfileSchema } from "@/lib/counterparty-profile";

const original = {
  id: "cp-test", name: "Unchanged Partner", code: "CP-100", type: CounterpartyType.TRADING_PARTNER,
  country: "Pakistan", side: "BUY", taxFilerStatus: "FILER", creditLimit: null,
  kycStatus: "PENDING", kycRef: null, kycExpires: null, companyNameNtn: null,
  ntn: "OLD-NTN", contactPerson: "Contact", contactPhone: "03000000000",
  address: "Address", bankDetails: "Bank", createdById: "owner", createdAt: new Date(), updatedAt: new Date(),
} as Counterparty;

const restorers: (() => void)[] = [];
function replace(target: object, key: string, implementation: unknown) {
  const object = target as Record<string, unknown>;
  const previous = object[key];
  object[key] = implementation;
  restorers.push(() => { object[key] = previous; });
}
function restore() { while (restorers.length) restorers.pop()!(); }
afterEach(restore);
function fixture(role: Role = "TRADER", record: Counterparty | null = original) {
  const writes: { target: string; args: unknown }[] = [];
  replace(prisma.user, "updateMany", async () => ({ count: 0 }));
  replace(prisma.counterparty, "findUnique", async () => record);
  const tx = {
    counterparty: { update: async (args: { where: { id: string }; data: Prisma.CounterpartyUpdateInput }) => {
      writes.push({ target: "counterparty", args });
      return { ...record, ...args.data };
    } },
    trade: { findMany: async (args: unknown) => {
      writes.push({ target: "tradeLookup", args }); return [{ tradeRef: "LINKED-1" }];
    } },
    executionContract: { updateMany: async (args: unknown) => {
      writes.push({ target: "contract", args }); return { count: 1 };
    } },
  };
  // Missing tx models intentionally fail if a profile edit touches ledgers,
  // gatepasses, inventory, or another unrelated table.
  replace(prisma, "$transaction", async (work: (db: unknown) => Promise<unknown>) => work(tx));
  const caller = traderRouter.createCaller({ prisma, session: {
    expires: "2099-01-01", user: { id: "trader", name: "Test Trader", email: "test@example.test", role, isHead: false },
  } });
  return { caller, writes };
}

test("profile endpoint edits contacts, preserves identifiers and touches no related records", async () => {
  const { caller, writes } = fixture();
  const result = await caller.updateCounterpartyProfile({ id: original.id, patch: { contactPhone: " 03001234567 ", address: "" } });
  assert.equal(result.name, original.name);
  assert.equal(result.code, original.code);
  assert.equal(result.id, original.id);
  assert.equal(result.contactPhone, "03001234567");
  assert.equal(result.address, null);
  assert.deepEqual(writes, [{ target: "counterparty", args: { where: { id: original.id }, data: { contactPhone: "03001234567", address: null } } }]);
});

test("NTN update synchronizes only contracts linked through the unchanged counterparty id", async () => {
  const { caller, writes } = fixture();
  await caller.updateCounterpartyProfile({ id: original.id, patch: { ntn: "NEW-NTN" } });
  assert.deepEqual(writes[1], { target: "tradeLookup", args: { where: { counterpartyId: original.id }, select: { tradeRef: true } } });
  assert.deepEqual(writes[2], { target: "contract", args: { where: { tradeRef: { in: ["LINKED-1"] } }, data: { counterpartyNtn: "NEW-NTN" } } });
});

test("rejects identity and relationship injection, even with a valid profile field", () => {
  for (const key of ["name", "code", "id", "side", "createdById", "trades", "ledgerEntries", "createdAt"]) {
    assert.equal(updateCounterpartyProfileSchema.safeParse({ id: original.id, patch: { contactPhone: "123", [key]: "changed" } }).success, false, key);
  }
});

test("rejects malformed profile values before a database write", () => {
  for (const patch of [{}, { country: " " }, { type: "INTERNAL" }, { kycExpires: "2026-02-30" }, { kycStatus: "invalid" }, { creditLimit: -1 }, { creditLimit: Infinity }, { contactPhone: "1".repeat(51) }]) {
    assert.equal(updateCounterpartyProfileSchema.safeParse({ id: original.id, patch }).success, false);
  }
});

test("validates expiry and updates tax and credit metadata without changing posted balances", async () => {
  const { caller, writes } = fixture();
  const result = await caller.updateCounterpartyProfile({ id: original.id, patch: { kycExpires: "2027-12-31", taxFilerStatus: "NON_FILER", creditLimit: 1000 } });
  assert.equal(result.kycExpires?.toISOString(), "2027-12-31T00:00:00.000Z");
  assert.equal(result.taxFilerStatus, "NON_FILER");
  assert.equal(result.creditLimit, 1000);
  assert.equal(writes.length, 1);
});

test("rejects non-trader roles, missing counterparties and internal system records", async () => {
  for (const [role, record, code] of [
    ["EXECUTION", original, "FORBIDDEN"],
    ["TRADER", null, "NOT_FOUND"],
    ["TRADER", { ...original, type: CounterpartyType.INTERNAL }, "FORBIDDEN"],
  ] as const) {
    const { caller, writes } = fixture(role, record);
    await assert.rejects(caller.updateCounterpartyProfile({ id: original.id, patch: { ntn: "test" } }), (error: unknown) => (error as { code: string }).code === code);
    assert.equal(writes.length, 0);
    restore();
  }
});
