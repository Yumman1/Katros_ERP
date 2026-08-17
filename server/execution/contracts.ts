import type { Prisma, PrismaClient } from "@prisma/client";
import { TradeDirection, TradeStatus } from "@prisma/client";
import {
  buyingCategoryFromIncoterms,
  DEFAULT_QUALITY_TOLERANCES,
  executionProfileFromTrade,
  KG_PER_MAUND,
  tradeScopeFromSeed,
  type BuyingCategory,
  type ExecutionProfile,
  type QualityTolerances,
  type TradeScope,
} from "@/lib/trade-constants";
import { kgToQuantityUnit, openQtyEpsilon } from "@/lib/unit-conversion";
import {
  contractAbsorbableQtyMt,
  DEFAULT_QUANTITY_TOLERANCE_MT,
  parseQuantityToleranceMt,
  shouldAutoCloseContract,
  warehouseAbsorbableQtyMt,
} from "@/lib/contract-closure";
import { defaultKgPerUnit } from "@/lib/price-units";
import type { MockTraderTrade } from "@/server/dummy-data";
import {
  mockTradeByRefGlobal,
  mockTraderTradeByRef,
} from "@/server/dummy-data";
import { lockedContractsToCsv } from "@/lib/execution-csv";
import { canonicalTraderName } from "@/lib/trader-identity";
import { getCompanyWarehouses } from "@/server/trader-master-data";
import {
  allocationsSumMatchesContract,
  contractHasWarehouseAllocation,
  contractMatchesWarehouse,
  formatTraderWarehouseSelections,
  normWarehouseName,
  parseExecutionWarehouseSplit,
  parseTraderWarehouseSelections,
  resolveWarehouseAllocations,
  type WarehouseAllocationLine,
} from "@/lib/warehouse-allocation";
import { prisma } from "@/server/db";
import { num } from "@/server/db/convert";
import {
  CONTRACT_INCLUDE,
  contractRowToRuntime,
  type ExecutionContract,
  type PendingTruck,
} from "./runtime";

type Db = PrismaClient | Prisma.TransactionClient;

function defaultIncotermForProfile(profile: ExecutionProfile): string {
  if (profile === "SALE_EX_WAREHOUSE") return "Ex-Warehouse";
  if (profile === "PURCHASE_SPOT") return "Spot";
  return "Delivered";
}

function normWarehouse(s: string): string {
  return normWarehouseName(s);
}

function normCp(s: string) {
  return s.trim().toLowerCase();
}

// ─── Fulfillment math (DB-backed) ─────────────────────────────────────────────

/** Fulfilled qty for a trade: non-DRAFT inbound + non-AT_GATE outbound + RECEIVED spot. */
async function computeFulfilledQty(
  db: Db,
  tradeRef: string,
  direction: TradeDirection,
  quantityUnit: string,
): Promise<number> {
  if (direction === TradeDirection.SELL) {
    const agg = await db.outboundDispatch.aggregate({
      where: { tradeRef, status: { not: "AT_GATE" } },
      _sum: { allocatedQtyMt: true },
    });
    return num(agg._sum.allocatedQtyMt);
  }
  const agg = await db.inboundReceipt.aggregate({
    where: { tradeRef, status: { not: "DRAFT" } },
    _sum: { allocatedQtyMt: true },
  });
  const spot = await db.spotPurchaseEvent.findUnique({ where: { tradeRef } });
  const spotWeightKg = spot ? num(spot.warehouseReceiveWeightKg) : 0;
  const spotQty =
    spot?.state === "RECEIVED" && spotWeightKg ? kgToQuantityUnit(spotWeightKg, quantityUnit) : 0;
  return num(agg._sum.allocatedQtyMt) + spotQty;
}

async function getFulfillmentByWarehouse(
  db: Db,
  tradeRef: string,
  direction: TradeDirection,
): Promise<Map<string, { name: string; qtyMt: number }>> {
  const map = new Map<string, { name: string; qtyMt: number }>();
  if (direction === TradeDirection.SELL) {
    const rows = await db.outboundDispatch.findMany({
      where: { tradeRef, status: { not: "AT_GATE" } },
      select: { warehouseName: true, allocatedQtyMt: true },
    });
    for (const d of rows) {
      const key = normWarehouse(d.warehouseName);
      const prev = map.get(key);
      map.set(key, {
        name: d.warehouseName,
        qtyMt: (prev?.qtyMt ?? 0) + num(d.allocatedQtyMt),
      });
    }
  } else {
    const rows = await db.inboundReceipt.findMany({
      where: { tradeRef, status: { not: "DRAFT" } },
      select: { warehouseName: true, allocatedQtyMt: true },
    });
    for (const r of rows) {
      const key = normWarehouse(r.warehouseName);
      const prev = map.get(key);
      map.set(key, {
        name: r.warehouseName,
        qtyMt: (prev?.qtyMt ?? 0) + num(r.allocatedQtyMt),
      });
    }
  }
  return map;
}

/** Fulfilled qty at one warehouse using a caller-supplied client (usable inside transactions). */
export async function fulfilledQtyForTradeAtWarehouseDb(
  db: Db,
  tradeRef: string,
  warehouseName: string,
  direction: TradeDirection,
): Promise<number> {
  const wh = normWarehouse(warehouseName);
  const fulfillment = await getFulfillmentByWarehouse(db, tradeRef, direction);
  return fulfillment.get(wh)?.qtyMt ?? 0;
}

export async function getFulfilledQtyForTradeAtWarehouse(
  tradeRef: string,
  warehouseName: string,
  direction: TradeDirection,
): Promise<number> {
  return fulfilledQtyForTradeAtWarehouseDb(prisma, tradeRef, warehouseName, direction);
}

/**
 * Recompute a contract's fulfillment from movements and auto-close it when the
 * received qty exceeds contract + tolerance. Runs inside a transaction with a
 * row lock on the contract so concurrent movement writers serialize.
 */
export async function refreshContract(tradeRef: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Row lock — concurrent refreshes/assignments for the same contract queue here.
    await tx.$queryRaw`SELECT "id" FROM "ExecutionContract" WHERE "tradeRef" = ${tradeRef} FOR UPDATE`;
    const row = await tx.executionContract.findUnique({
      where: { tradeRef },
      include: {
        warehouseAllocations: true,
        trade: { select: { tradeStatus: true } },
      },
    });
    if (!row) return;

    const contractualQtyMt = num(row.contractualQtyMt);
    const fulfilled = await computeFulfilledQty(tx, tradeRef, row.direction, row.quantityUnit);
    const open = Math.max(0, contractualQtyMt - fulfilled);
    const autoClose = shouldAutoCloseContract({
      contractualQtyMt,
      receivedQtyMt: fulfilled,
      toleranceMt: num(row.quantityToleranceMt),
    });
    const forceClosed =
      row.trade.tradeStatus === TradeStatus.EXECUTED ||
      row.trade.tradeStatus === TradeStatus.SETTLED;
    const nextStatus: "Open" | "Close" = forceClosed || autoClose ? "Close" : "Open";

    const fulfillment = await getFulfillmentByWarehouse(tx, tradeRef, row.direction);
    for (const alloc of row.warehouseAllocations) {
      const fulfilledAtWh = fulfillment.get(normWarehouse(alloc.warehouseName))?.qtyMt ?? 0;
      if (Math.abs(num(alloc.fulfilledQtyMt) - fulfilledAtWh) > 1e-9) {
        await tx.contractWarehouseAllocation.update({
          where: { id: alloc.id },
          data: { fulfilledQtyMt: fulfilledAtWh },
        });
      }
    }

    await tx.executionContract.update({
      where: { id: row.id },
      data: { receivedQtyMt: fulfilled, openQtyMt: open, contractStatus: nextStatus },
    });

    if (nextStatus === "Close" && row.trade.tradeStatus === TradeStatus.LOCKED) {
      await tx.trade.update({
        where: { tradeRef },
        data: { tradeStatus: TradeStatus.EXECUTED },
      });
    }
  });
}

/** No-op in DB mode — contracts are kept consistent on every write. */
export async function syncAllLockedContracts(): Promise<void> {}

export function contractRequiresWarehouse(c: ExecutionContract): boolean {
  return c.executionProfile === "PURCHASE_DELIVERED" || c.executionProfile === "SALE_EX_WAREHOUSE";
}

export function counterpartyMatchesTruck(truck: PendingTruck, contract: ExecutionContract): boolean {
  const cp = normCp(contract.counterpartyName);
  const n = normCp(truck.counterpartyName);
  return cp === n || cp.includes(n) || n.includes(cp);
}

export function commodityMatchesTruck(truck: PendingTruck, contract: ExecutionContract): boolean {
  if (!truck.commodityCode?.trim()) return true;
  return contract.commodityCode === truck.commodityCode;
}

export function fifoSortContracts(contracts: ExecutionContract[]): ExecutionContract[] {
  return [...contracts].sort((a, b) => {
    const da = a.deliveryEnd ? new Date(a.deliveryEnd).getTime() : Infinity;
    const db = b.deliveryEnd ? new Date(b.deliveryEnd).getTime() : Infinity;
    if (da !== db) return da - db;
    return a.lockedAt.getTime() - b.lockedAt.getTime();
  });
}

export function normalizeContract(c: ExecutionContract): ExecutionContract {
  if (!(c as Partial<ExecutionContract>).quantityUnit) {
    c.quantityUnit = "MT";
  }
  if (!(c as Partial<ExecutionContract>).tradeScope) {
    c.tradeScope = tradeScopeFromSeed(c.tradeRef);
  }
  if (!(c as Partial<ExecutionContract>).incoterms) {
    c.incoterms = defaultIncotermForProfile(c.executionProfile);
  }
  if ((c as Partial<ExecutionContract>).allocatedWarehouse === undefined) {
    c.allocatedWarehouse = null;
  }
  if ((c as Partial<ExecutionContract>).traderWarehouseHint === undefined) {
    c.traderWarehouseHint = null;
  }
  if (!(c as Partial<ExecutionContract>).traderWarehouseSelections?.length) {
    c.traderWarehouseSelections = c.traderWarehouseHint
      ? c.traderWarehouseHint.split(/\s+\+\s+/).map((s) => s.trim()).filter(Boolean)
      : [];
  }
  if (!(c as Partial<ExecutionContract>).warehouseAllocations) {
    c.warehouseAllocations = resolveWarehouseAllocations(c);
  }
  if ((c as Partial<ExecutionContract>).quantityToleranceMt == null) {
    c.quantityToleranceMt = DEFAULT_QUANTITY_TOLERANCE_MT;
  }
  if (!c.warehouseAllocations.length && c.allocatedWarehouse?.trim()) {
    c.warehouseAllocations = [
      { warehouseName: c.allocatedWarehouse.trim(), qtyMt: c.contractualQtyMt },
    ];
  }
  if (c.warehouseAllocations.length === 1) {
    c.allocatedWarehouse = c.warehouseAllocations[0]!.warehouseName;
  } else if (c.warehouseAllocations.length > 1) {
    c.allocatedWarehouse = c.warehouseAllocations.map((a) => a.warehouseName).join(" + ");
  } else {
    c.allocatedWarehouse = null;
  }
  if (c.unitPrice == null && c.ratePerMaund != null) {
    c.unitPrice = c.ratePerMaund;
    c.priceCurrency = c.priceCurrency ?? (c.currency === "USD" ? "USD" : "PKR");
    c.priceWeightUnit = c.priceWeightUnit ?? "MAUND_40";
  }
  return c;
}

/** Formats a date as YYYY-MM-DD for user-facing delivery-window messages. */
function deliveryDateLabel(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * A trade must be fulfilled within its booked delivery period. Blocks a movement
 * dated outside the window unless the caller is allowed to override (head of
 * execution). Applies to all trades — local and international.
 */
export function assertWithinDeliveryWindow(
  contract: ExecutionContract,
  when: Date,
  allowOutside: boolean,
): void {
  if (allowOutside) return;
  const day = new Date(when);
  day.setHours(0, 0, 0, 0);
  if (contract.deliveryStart) {
    const start = new Date(contract.deliveryStart);
    start.setHours(0, 0, 0, 0);
    if (day < start) {
      throw new Error(
        `Delivery window for ${contract.tradeRef} opens ${deliveryDateLabel(contract.deliveryStart)}. Fulfilment cannot start earlier — the head of execution can override.`,
      );
    }
  }
  if (contract.deliveryEnd) {
    const end = new Date(contract.deliveryEnd);
    end.setHours(0, 0, 0, 0);
    if (day > end) {
      throw new Error(
        `Delivery window for ${contract.tradeRef} closed ${deliveryDateLabel(contract.deliveryEnd)}. The trade must be fulfilled within its delivery period — the head of execution can override.`,
      );
    }
  }
}

function assertCanEditWarehouseAllocation(contract: ExecutionContract): void {
  if (contract.contractStatus !== "Open") {
    throw new Error(
      `Trade ${contract.tradeRef} is fully fulfilled — warehouse allocation can no longer be changed`,
    );
  }
}

export type WarehouseAllocationProgress = WarehouseAllocationLine & {
  fulfilledQtyMt: number;
  openQtyMt: number;
  /** Remaining assignable qty incl. booked tolerance (outbound assignment cap). */
  absorbableQtyMt: number;
};

/** Pure progress math from allocation lines + a fulfillment-by-warehouse map. */
function computeWarehouseProgress(
  contract: ExecutionContract,
  fulfillment: Map<string, { name: string; qtyMt: number }>,
): WarehouseAllocationProgress[] {
  const c = normalizeContract(contract);
  const allocated = resolveWarehouseAllocations(c);
  const toleranceMt = c.quantityToleranceMt ?? DEFAULT_QUANTITY_TOLERANCE_MT;
  const contractFulfilledMt = c.receivedQtyMt;
  const keys = new Set<string>();
  for (const a of allocated) keys.add(normWarehouse(a.warehouseName));
  for (const key of fulfillment.keys()) keys.add(key);

  const nameByKey = new Map<string, string>();
  for (const a of allocated) nameByKey.set(normWarehouse(a.warehouseName), a.warehouseName);
  for (const [key, val] of fulfillment) nameByKey.set(key, val.name);

  return [...keys]
    .map((key) => {
      const warehouseName = nameByKey.get(key)!;
      const allocQty = allocated
        .filter((a) => normWarehouse(a.warehouseName) === key)
        .reduce((s, a) => s + a.qtyMt, 0);
      const fulfilledQtyMt = fulfillment.get(key)?.qtyMt ?? 0;
      const qtyMt = allocQty > openQtyEpsilon(c.quantityUnit) ? allocQty : fulfilledQtyMt;
      return {
        warehouseName,
        qtyMt,
        fulfilledQtyMt,
        openQtyMt: Math.max(0, qtyMt - fulfilledQtyMt),
        absorbableQtyMt: warehouseAbsorbableQtyMt({
          contractualQtyMt: c.contractualQtyMt,
          contractFulfilledMt,
          whAllocatedMt: allocQty,
          whFulfilledMt: fulfilledQtyMt,
          toleranceMt,
        }),
      };
    })
    .filter(
      (p) =>
        p.qtyMt > openQtyEpsilon(c.quantityUnit) ||
        p.fulfilledQtyMt > openQtyEpsilon(c.quantityUnit),
    )
    .sort((a, b) => a.warehouseName.localeCompare(b.warehouseName));
}

export async function getWarehouseAllocationProgress(
  contract: ExecutionContract,
): Promise<WarehouseAllocationProgress[]> {
  const c = normalizeContract(contract);
  const fulfillment = await getFulfillmentByWarehouse(prisma, c.tradeRef, c.direction);
  return computeWarehouseProgress(c, fulfillment);
}

/** Merge remaining (open) qty split with locked fulfilled qty per warehouse into stored totals. */
function mergeOpenAllocationsToTotals(
  contract: ExecutionContract,
  progress: WarehouseAllocationProgress[],
  openAllocations: { warehouseName: string; openQtyMt: number }[],
): WarehouseAllocationLine[] {
  const unit = contract.quantityUnit;
  const fulfilledByWh = new Map(
    progress.map((p) => [normWarehouse(p.warehouseName), p.fulfilledQtyMt]),
  );
  const displayNameByWh = new Map<string, string>();
  for (const p of progress) {
    displayNameByWh.set(normWarehouse(p.warehouseName), p.warehouseName);
  }

  const openByWh = new Map<string, number>();
  for (const line of openAllocations) {
    const name = line.warehouseName?.trim();
    if (!name) throw new Error("Each warehouse line must have a warehouse name");
    const key = normWarehouse(name);
    if (line.openQtyMt < 0) {
      throw new Error(`Open quantity for ${name} cannot be negative`);
    }
    displayNameByWh.set(key, name);
    openByWh.set(key, (openByWh.get(key) ?? 0) + line.openQtyMt);
  }

  const whKeys = new Set<string>();
  for (const p of progress) {
    if (p.fulfilledQtyMt > openQtyEpsilon(unit) || p.openQtyMt > openQtyEpsilon(unit)) {
      whKeys.add(normWarehouse(p.warehouseName));
    }
  }
  for (const key of openByWh.keys()) whKeys.add(key);

  let openSum = 0;
  const totals: WarehouseAllocationLine[] = [];
  for (const key of whKeys) {
    const fulfilled = fulfilledByWh.get(key) ?? 0;
    const open = openByWh.get(key) ?? 0;
    const total = fulfilled + open;
    if (total <= openQtyEpsilon(unit) && fulfilled <= openQtyEpsilon(unit) && open <= openQtyEpsilon(unit)) {
      continue;
    }
    if (open <= openQtyEpsilon(unit) && fulfilled <= openQtyEpsilon(unit)) continue;
    const name = displayNameByWh.get(key);
    if (!name) throw new Error("Warehouse name missing for allocation line");
    totals.push({ warehouseName: name, qtyMt: total });
    openSum += open;
  }

  if (!allocationsSumMatchesContract(openSum, contract.openQtyMt, unit)) {
    throw new Error(
      `Remaining split must total ${contract.openQtyMt} ${unit} (currently ${openSum.toFixed(3)} ${unit})`,
    );
  }

  const totalSum = totals.reduce((s, t) => s + t.qtyMt, 0);
  if (!allocationsSumMatchesContract(totalSum, contract.contractualQtyMt, unit)) {
    throw new Error(
      `Total per warehouse (fulfilled + remaining) must equal ${contract.contractualQtyMt} ${unit} (currently ${totalSum.toFixed(3)} ${unit})`,
    );
  }

  return totals;
}

function allocationDisplayLabel(totals: WarehouseAllocationLine[]): string | null {
  if (totals.length === 1) return totals[0]!.warehouseName;
  if (totals.length > 1) return totals.map((a) => a.warehouseName).join(" + ");
  return null;
}

/** Replace a contract's allocation rows with new totals (inside a transaction). */
async function writeAllocations(
  tx: Prisma.TransactionClient,
  contractId: string,
  totals: WarehouseAllocationLine[],
  fulfillment: Map<string, { name: string; qtyMt: number }>,
): Promise<void> {
  await tx.contractWarehouseAllocation.deleteMany({ where: { contractId } });
  if (totals.length) {
    await tx.contractWarehouseAllocation.createMany({
      data: totals.map((t) => ({
        contractId,
        warehouseName: t.warehouseName,
        qtyMt: t.qtyMt,
        fulfilledQtyMt: fulfillment.get(normWarehouse(t.warehouseName))?.qtyMt ?? 0,
      })),
    });
  }
  await tx.executionContract.update({
    where: { id: contractId },
    data: { allocatedWarehouse: allocationDisplayLabel(totals) },
  });
}

export async function allocateContractWarehouse(
  tradeRef: string,
  warehouseName: string | null,
): Promise<ExecutionContract> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ExecutionContract" WHERE "tradeRef" = ${tradeRef} FOR UPDATE`;
    const row = await tx.executionContract.findUnique({
      where: { tradeRef },
      include: CONTRACT_INCLUDE,
    });
    if (!row) throw new Error("Locked contract not found: " + tradeRef);
    const normalized = normalizeContract(contractRowToRuntime(row));
    assertCanEditWarehouseAllocation(normalized);
    const fulfillment = await getFulfillmentByWarehouse(tx, tradeRef, normalized.direction);

    let totals: WarehouseAllocationLine[];
    if (!warehouseName?.trim()) {
      if (
        [...fulfillment.values()].some((f) => f.qtyMt > openQtyEpsilon(normalized.quantityUnit))
      ) {
        throw new Error(
          "Cannot clear warehouse allocation while quantity has already been received or dispatched",
        );
      }
      totals = [];
    } else {
      const progress = computeWarehouseProgress(normalized, fulfillment);
      const hasOtherFulfillment = progress.some(
        (p) =>
          normWarehouse(p.warehouseName) !== normWarehouse(warehouseName) &&
          p.fulfilledQtyMt > openQtyEpsilon(normalized.quantityUnit),
      );
      if (hasOtherFulfillment) {
        throw new Error(
          "Trade is partially fulfilled at other warehouses — use the split editor to reassign the remaining quantity",
        );
      }
      totals = mergeOpenAllocationsToTotals(normalized, progress, [
        { warehouseName: warehouseName.trim(), openQtyMt: normalized.openQtyMt },
      ]);
    }

    await writeAllocations(tx, row.id, totals, fulfillment);
    const fresh = await tx.executionContract.findUnique({
      where: { tradeRef },
      include: CONTRACT_INCLUDE,
    });
    return normalizeContract(contractRowToRuntime(fresh!));
  });
}

export async function allocateContractWarehousesSplit(
  tradeRef: string,
  openAllocations: { warehouseName: string; openQtyMt: number }[],
): Promise<ExecutionContract> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ExecutionContract" WHERE "tradeRef" = ${tradeRef} FOR UPDATE`;
    const row = await tx.executionContract.findUnique({
      where: { tradeRef },
      include: CONTRACT_INCLUDE,
    });
    if (!row) throw new Error("Locked contract not found: " + tradeRef);
    const normalized = normalizeContract(contractRowToRuntime(row));
    assertCanEditWarehouseAllocation(normalized);
    if (!contractRequiresWarehouse(normalized)) {
      throw new Error("This trade type does not use warehouse allocation");
    }
    if (!openAllocations.length) {
      throw new Error("At least one warehouse line is required");
    }
    const seen = new Set<string>();
    for (const line of openAllocations) {
      const key = normWarehouse(line.warehouseName.trim());
      if (seen.has(key)) {
        throw new Error(`Duplicate warehouse "${line.warehouseName}" in allocation split`);
      }
      seen.add(key);
    }
    const fulfillment = await getFulfillmentByWarehouse(tx, tradeRef, normalized.direction);
    const progress = computeWarehouseProgress(normalized, fulfillment);
    const totals = mergeOpenAllocationsToTotals(normalized, progress, openAllocations);

    await writeAllocations(tx, row.id, totals, fulfillment);
    const fresh = await tx.executionContract.findUnique({
      where: { tradeRef },
      include: CONTRACT_INCLUDE,
    });
    return normalizeContract(contractRowToRuntime(fresh!));
  });
}

export async function lockTradeInStore(
  traderName: string,
  tradeRef: string,
  input: {
    lockedBy: string;
    buyingCategory?: BuyingCategory;
    ratePerMaund?: number;
    commissionPerMaund?: number;
    qualityTolerances?: QualityTolerances;
  },
): Promise<MockTraderTrade> {
  const trade =
    (await mockTraderTradeByRef(canonicalTraderName(traderName), tradeRef)) ??
    (await mockTradeByRefGlobal(tradeRef));
  if (!trade) throw new Error("Trade not found");
  if (trade.settlementRequested === true || trade.directSettled === true) {
    throw new Error("This trade is in direct settlement — it cannot be locked");
  }
  if (trade.tradeStatus !== TradeStatus.PENDING) {
    throw new Error(`Only PENDING trades can be locked (current: ${trade.tradeStatus})`);
  }
  if (trade.pendingTraderPrice) {
    throw new Error(
      "Trader must enter the contract price from My Trades before this trade can be locked",
    );
  }
  // Internal routing only — derived from the trade's incoterm (only "Spot" uses
  // the spot pipeline). Trades stay categorized by their incoterm everywhere.
  const buyingCategory =
    trade.direction === TradeDirection.SELL
      ? null
      : (input.buyingCategory ??
        buyingCategoryFromIncoterms(trade.incoterms, trade.direction) ??
        trade.buyingCategory ??
        "Delivered");
  const profile = executionProfileFromTrade(trade.direction, buyingCategory, trade.incoterms);

  // Real settlement rate is per kg (base currency). Prefer an explicit maund rate, else the
  // canonical mapped price, else legacy fallbacks. `ratePerMaund` is kept for display continuity.
  const canonicalKg = defaultKgPerUnit(trade.quantityUnit ?? "MT");
  let ratePerMaund: number;
  let ratePerKg: number;
  if (input.ratePerMaund != null) {
    ratePerMaund = input.ratePerMaund;
    ratePerKg = ratePerMaund / KG_PER_MAUND;
  } else if (trade.pricePerCanonicalQty != null) {
    ratePerKg = trade.pricePerCanonicalQty / canonicalKg;
    ratePerMaund = ratePerKg * KG_PER_MAUND;
  } else {
    ratePerMaund = trade.ratePerMaund ?? trade.price;
    ratePerKg = ratePerMaund / KG_PER_MAUND;
  }

  trade.tradeStatus = TradeStatus.LOCKED;
  trade.lockedAt = new Date();
  trade.lockedBy = input.lockedBy;
  trade.buyingCategory = buyingCategory;
  trade.executionProfile = profile;
  trade.ratePerMaund = ratePerMaund;
  trade.ratePerKg = ratePerKg;
  trade.commissionPerMaund = input.commissionPerMaund ?? trade.commissionPerMaund ?? 0;
  trade.qualityTolerancesDetail =
    input.qualityTolerances ?? trade.qualityTolerancesDetail ?? DEFAULT_QUALITY_TOLERANCES;

  const qtyUnit = trade.quantityUnit ?? trade.commodity.unit ?? "MT";
  const toleranceMt = parseQuantityToleranceMt(trade.quantity, qtyUnit, trade.tradeParams);
  const traderSelections = parseTraderWarehouseSelections(trade.tradeParams ?? null);
  const traderHint = formatTraderWarehouseSelections(traderSelections);
  const splitPlan = parseExecutionWarehouseSplit(trade.tradeParams);
  const companyWarehouses = await getCompanyWarehouses();
  const resolveCompanyWarehouseName = (hint: string): string | null => {
    const key = normWarehouse(hint);
    const match = companyWarehouses.find((w) => normWarehouse(w.name) === key);
    return match?.name ?? null;
  };
  const requiresWarehouse = profile === "PURCHASE_DELIVERED" || profile === "SALE_EX_WAREHOUSE";
  const allocationLines: WarehouseAllocationLine[] =
    requiresWarehouse && splitPlan.length > 0 && trade.warehouseSplitApproved !== false
      ? splitPlan.map((line) => ({
          warehouseName: resolveCompanyWarehouseName(line.warehouseName) ?? line.warehouseName,
          qtyMt: line.openQtyMt,
        }))
      : [];

  await prisma.$transaction(async (tx) => {
    const existing = await tx.executionContract.findUnique({
      where: { tradeRef },
      select: { id: true },
    });
    if (existing) {
      throw new Error(`Trade ${tradeRef} is already locked — contract exists`);
    }
    // Guarded lock — a concurrent lock of the same trade loses here.
    const locked = await tx.trade.updateMany({
      where: { tradeRef, tradeStatus: TradeStatus.PENDING },
      data: {
        tradeStatus: TradeStatus.LOCKED,
        lockedAt: trade.lockedAt,
        lockedBy: trade.lockedBy,
        buyingCategory,
        executionProfile: profile,
        ratePerMaund,
        ratePerKg,
        commissionPerMaund: trade.commissionPerMaund,
        qualityTolerancesDetail: trade.qualityTolerancesDetail as unknown as Prisma.InputJsonValue,
      },
    });
    if (locked.count === 0) {
      throw new Error(`Only PENDING trades can be locked (current: ${trade.tradeStatus})`);
    }

    const contract = await tx.executionContract.create({
      data: {
        tradeRef: trade.tradeRef,
        tradeId: trade.id,
        contractDate: trade.tradeDate,
        direction: trade.direction,
        executionProfile: profile,
        tradeScope: trade.tradeScope ?? tradeScopeFromSeed(trade.tradeRef),
        incoterms: trade.incoterms || defaultIncotermForProfile(profile),
        buyingCategory:
          buyingCategory ??
          (profile === "PURCHASE_SPOT"
            ? "Spot"
            : profile === "PURCHASE_DELIVERED"
              ? "Delivered"
              : null),
        commodityCode: trade.commodity.code,
        commodityName: trade.commodity.name,
        counterpartyName: trade.counterparty.name,
        counterpartyCode: trade.counterparty.code,
        counterpartyNtn: trade.counterparty.ntn ?? null,
        quantityUnit: qtyUnit,
        contractualQtyMt: trade.quantity,
        receivedQtyMt: 0,
        openQtyMt: trade.quantity,
        contractStatus: "Open",
        quantityToleranceMt: toleranceMt,
        qualityTolerances:
          (trade.qualityTolerancesDetail ?? DEFAULT_QUALITY_TOLERANCES) as unknown as Prisma.InputJsonValue,
        ratePerMaund,
        ratePerKg,
        unitPrice: trade.price ?? null,
        priceCurrency: trade.priceCurrency ?? null,
        priceWeightUnit: trade.priceWeightUnit ?? trade.quantityUnit ?? null,
        commissionPerMaund: trade.commissionPerMaund ?? null,
        currency: trade.currency,
        warehouseDefault: traderHint,
        traderWarehouseHint: traderHint,
        traderWarehouseSelections: traderSelections,
        allocatedWarehouse:
          allocationLines.length === 1 ? allocationLines[0]!.warehouseName : null,
        traderName: trade.traderName,
        lockedAt: trade.lockedAt!,
        lockedBy: trade.lockedBy ?? trade.traderName,
        deliveryStart: trade.deliveryStart ?? null,
        deliveryEnd: trade.deliveryEnd ?? null,
      },
      select: { id: true },
    });

    if (allocationLines.length) {
      // Merge duplicate warehouse names — (contractId, warehouseName) is unique.
      const merged = new Map<string, WarehouseAllocationLine>();
      for (const line of allocationLines) {
        const key = normWarehouse(line.warehouseName);
        const prev = merged.get(key);
        merged.set(key, {
          warehouseName: prev?.warehouseName ?? line.warehouseName,
          qtyMt: (prev?.qtyMt ?? 0) + line.qtyMt,
        });
      }
      await tx.contractWarehouseAllocation.createMany({
        data: [...merged.values()].map((line) => ({
          contractId: contract.id,
          warehouseName: line.warehouseName,
          qtyMt: line.qtyMt,
          fulfilledQtyMt: 0,
        })),
      });
    }

    if (profile === "PURCHASE_SPOT") {
      await tx.spotPurchaseEvent.upsert({
        where: { tradeRef },
        update: { state: "CONTRACT" },
        create: { tradeRef, state: "CONTRACT" },
      });
    }
  });

  // Pick up any pre-existing fulfillment (re-lock edge cases) + auto-close math.
  await refreshContract(tradeRef);
  return trade;
}

/** Move a locked contract to closed (EXECUTED) — manual or auto-close path. */
export async function closeLockedContract(
  tradeRef: string,
  closedBy: string,
): Promise<MockTraderTrade> {
  void closedBy;
  const ref = tradeRef.trim();
  const trade = await mockTradeByRefGlobal(ref);
  if (!trade) throw new Error("Trade not found");
  if (trade.tradeStatus !== TradeStatus.LOCKED) {
    throw new Error(`Only locked contracts can be closed (current: ${trade.tradeStatus})`);
  }
  await prisma.$transaction(async (tx) => {
    const updated = await tx.trade.updateMany({
      where: { tradeRef: ref, tradeStatus: TradeStatus.LOCKED },
      data: { tradeStatus: TradeStatus.EXECUTED },
    });
    if (updated.count === 0) {
      throw new Error(`Only locked contracts can be closed (current: ${trade.tradeStatus})`);
    }
    await tx.executionContract.updateMany({
      where: { tradeRef: ref },
      data: { contractStatus: "Close" },
    });
  });
  await refreshContract(ref);
  trade.tradeStatus = TradeStatus.EXECUTED;
  return trade;
}

/** No-op in DB mode — the database is the source of truth (no mirror to warm). */
export async function ensureContractsMirror(): Promise<void> {}

export type ExecutionContractView = ExecutionContract & {
  warehouseAllocationProgress: WarehouseAllocationProgress[];
  /** Contract-level headroom before contract + tolerance ceiling. */
  absorbableQtyMt: number;
};

export async function withWarehouseProgress(
  contract: ExecutionContract,
): Promise<ExecutionContractView> {
  const c = normalizeContract(contract);
  const warehouseAllocationProgress = await getWarehouseAllocationProgress(c);
  const toleranceMt = c.quantityToleranceMt ?? DEFAULT_QUANTITY_TOLERANCE_MT;
  return {
    ...c,
    warehouseAllocationProgress,
    absorbableQtyMt: contractAbsorbableQtyMt(
      c.contractualQtyMt,
      c.receivedQtyMt,
      toleranceMt,
    ),
  };
}

/** Batch fulfillment-by-warehouse maps for many contracts (2 queries total). */
async function batchFulfillmentByWarehouse(
  contracts: ExecutionContract[],
): Promise<Map<string, Map<string, { name: string; qtyMt: number }>>> {
  const result = new Map<string, Map<string, { name: string; qtyMt: number }>>();
  const buyRefs = contracts
    .filter((c) => c.direction !== TradeDirection.SELL)
    .map((c) => c.tradeRef);
  const sellRefs = contracts
    .filter((c) => c.direction === TradeDirection.SELL)
    .map((c) => c.tradeRef);
  const add = (tradeRef: string, warehouseName: string, qtyMt: number) => {
    const map = result.get(tradeRef) ?? new Map<string, { name: string; qtyMt: number }>();
    const key = normWarehouse(warehouseName);
    const prev = map.get(key);
    map.set(key, { name: warehouseName, qtyMt: (prev?.qtyMt ?? 0) + qtyMt });
    result.set(tradeRef, map);
  };
  if (buyRefs.length) {
    const rows = await prisma.inboundReceipt.findMany({
      where: { tradeRef: { in: buyRefs }, status: { not: "DRAFT" } },
      select: { tradeRef: true, warehouseName: true, allocatedQtyMt: true },
    });
    for (const r of rows) add(r.tradeRef, r.warehouseName, num(r.allocatedQtyMt));
  }
  if (sellRefs.length) {
    const rows = await prisma.outboundDispatch.findMany({
      where: { tradeRef: { in: sellRefs }, status: { not: "AT_GATE" } },
      select: { tradeRef: true, warehouseName: true, allocatedQtyMt: true },
    });
    for (const d of rows) add(d.tradeRef, d.warehouseName, num(d.allocatedQtyMt));
  }
  return result;
}

export async function getLockedContracts(filter?: {
  profile?: ExecutionProfile;
  incoterms?: string;
  tradeScope?: TradeScope;
  openOnly?: boolean;
  from?: Date;
  to?: Date;
  warehouseName?: string;
  warehouseAllocated?: boolean;
  warehouseUnallocated?: boolean;
}): Promise<ExecutionContractView[]> {
  const where: Prisma.ExecutionContractWhereInput = {};
  if (filter?.profile) where.executionProfile = filter.profile;
  if (filter?.incoterms) where.incoterms = filter.incoterms;
  if (filter?.tradeScope) where.tradeScope = filter.tradeScope;
  if (filter?.openOnly) where.contractStatus = "Open";
  if (filter?.from || filter?.to) {
    where.lockedAt = {
      ...(filter?.from ? { gte: filter.from } : {}),
      ...(filter?.to ? { lte: filter.to } : {}),
    };
  }
  const rows = await prisma.executionContract.findMany({
    where,
    include: CONTRACT_INCLUDE,
    orderBy: { lockedAt: "desc" },
  });
  let list = rows.map((r) => normalizeContract(contractRowToRuntime(r)));
  if (filter?.warehouseAllocated) {
    list = list.filter((c) => contractHasWarehouseAllocation(c));
  }
  if (filter?.warehouseUnallocated) {
    list = list.filter((c) => contractRequiresWarehouse(c) && !contractHasWarehouseAllocation(c));
  }
  if (filter?.warehouseName?.trim()) {
    list = list.filter((c) => contractMatchesWarehouse(c, filter.warehouseName!));
  }
  const fulfillment = await batchFulfillmentByWarehouse(list);
  return list.map((c) => {
    const warehouseAllocationProgress = computeWarehouseProgress(
      c,
      fulfillment.get(c.tradeRef) ?? new Map(),
    );
    const toleranceMt = c.quantityToleranceMt ?? DEFAULT_QUANTITY_TOLERANCE_MT;
    return {
      ...c,
      warehouseAllocationProgress,
      absorbableQtyMt: contractAbsorbableQtyMt(
        c.contractualQtyMt,
        c.receivedQtyMt,
        toleranceMt,
      ),
    };
  });
}

/** Open warehouse-backed trades still waiting for execution head to assign a warehouse. */
export async function getContractsPendingWarehouseAllocation(): Promise<ExecutionContractView[]> {
  return getLockedContracts({ openOnly: true, warehouseUnallocated: true });
}

export async function getContractByRef(tradeRef: string): Promise<ExecutionContractView | null> {
  const row = await prisma.executionContract.findUnique({
    where: { tradeRef },
    include: CONTRACT_INCLUDE,
  });
  if (!row) return null;
  return withWarehouseProgress(contractRowToRuntime(row));
}

export async function getPendingTradesForExecution() {
  const rows = await prisma.trade.findMany({
    where: {
      tradeStatus: TradeStatus.PENDING,
      submittedToExecution: true,
      pendingTraderReview: true,
    },
    include: { commodity: true, counterparty: true },
    orderBy: { tradeDate: "desc" },
  });
  return rows.map((t) => ({
    tradeRef: t.tradeRef,
    tradeDate: t.tradeDate,
    traderName: t.traderName,
    direction: t.direction,
    commodityCode: t.commodity.code,
    commodityName: t.commodity.name,
    quantity: num(t.quantity),
    quantityUnit: t.quantityUnit ?? t.commodity.unit,
    counterpartyName: t.counterparty.name,
    buyingCategory: t.buyingCategory ?? null,
    tradeScope: t.tradeScope ?? tradeScopeFromSeed(t.tradeRef),
    executionProfile: t.executionProfile ?? null,
    expectedProfile: executionProfileFromTrade(t.direction, t.buyingCategory, t.incoterms),
  }));
}

export async function getDeskSummary() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [
    contractRows,
    pending,
    openTradesCount,
    inboundToday,
    outboundToday,
    pendingFinance,
    pendingTrucksUnassigned,
  ] = await Promise.all([
    prisma.executionContract.findMany({ include: CONTRACT_INCLUDE }),
    getPendingTradesForExecution(),
    prisma.trade.count({
      where: { tradeStatus: TradeStatus.PENDING, submittedToExecution: true },
    }),
    prisma.inboundReceipt.count({ where: { receiveDate: { gte: today } } }),
    prisma.outboundDispatch.count({ where: { dispatchDate: { gte: today } } }),
    prisma.paymentRequest.count({ where: { status: "PENDING" } }),
    prisma.pendingTruck.count({ where: { status: { in: ["PENDING", "PARTIAL"] } } }),
  ]);
  const locked = contractRows.map((r) => normalizeContract(contractRowToRuntime(r)));
  const open = locked.filter((c) => c.contractStatus === "Open");
  const vehiclesToday = inboundToday + outboundToday;
  const pendingWarehouseAllocation = open.filter(
    (c) => contractRequiresWarehouse(c) && !contractHasWarehouseAllocation(c),
  ).length;
  return {
    pendingLock: pending.length,
    openTrades: openTradesCount,
    pendingWarehouseAllocation,
    lockedOpen: open.length,
    lockedTotal: locked.length,
    vehiclesToday,
    pendingFinance,
    pendingTrucksUnassigned,
    purchaseDeliveredOpen: open.filter((c) => c.executionProfile === "PURCHASE_DELIVERED").length,
    purchaseSpotOpen: open.filter((c) => c.executionProfile === "PURCHASE_SPOT").length,
    saleOpen: open.filter((c) => c.executionProfile === "SALE_EX_WAREHOUSE").length,
    localOpen: open.filter((c) => c.tradeScope === "LOCAL").length,
    internationalOpen: open.filter((c) => c.tradeScope === "INTERNATIONAL").length,
    localPurchaseDeliveredOpen: open.filter(
      (c) => c.executionProfile === "PURCHASE_DELIVERED" && c.tradeScope === "LOCAL",
    ).length,
    internationalPurchaseDeliveredOpen: open.filter(
      (c) => c.executionProfile === "PURCHASE_DELIVERED" && c.tradeScope === "INTERNATIONAL",
    ).length,
    localPurchaseSpotOpen: open.filter(
      (c) => c.executionProfile === "PURCHASE_SPOT" && c.tradeScope === "LOCAL",
    ).length,
    internationalPurchaseSpotOpen: open.filter(
      (c) => c.executionProfile === "PURCHASE_SPOT" && c.tradeScope === "INTERNATIONAL",
    ).length,
    localSaleOpen: open.filter(
      (c) => c.executionProfile === "SALE_EX_WAREHOUSE" && c.tradeScope === "LOCAL",
    ).length,
    internationalSaleOpen: open.filter(
      (c) => c.executionProfile === "SALE_EX_WAREHOUSE" && c.tradeScope === "INTERNATIONAL",
    ).length,
  };
}

export async function exportLockedContractsCsv(
  from: Date,
  to: Date,
  profile?: ExecutionProfile,
  incoterms?: string,
): Promise<string> {
  const list = await getLockedContracts({ from, to, profile, incoterms });
  return lockedContractsToCsv(list);
}

/** No-op in DB mode — nothing to seed or warm. */
export async function seedExecutionDemoIfEmpty(): Promise<void> {}

export type { Db };
