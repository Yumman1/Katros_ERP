import {
  CommodityCategory,
  CounterpartySide,
  CounterpartyType,
  LocationType,
  Prisma,
  TaxFilerStatus,
} from "@prisma/client";
import type { Commodity, Counterparty, Location } from "@prisma/client";
import {
  DEFAULT_GRADES,
  INCOTERMS,
  incotermsForDirection,
  QUANTITY_UNITS,
  isCornCommodity,
  isGrainCommodityCode,
} from "@/lib/trade-constants";
import { defaultCategoryForCommodityCode } from "@/lib/commodity-category";
import type { KycStatus } from "@/lib/trade-constants";
import type { TradeParamDefinition } from "@/lib/trade-parameters";
import {
  canonicalKgPerUnitOf,
  PRICE_CURRENCIES,
  PRICE_WEIGHT_UNITS,
  resolvePriceBasis,
  type CommodityPriceUnits,
  type PriceBasis,
} from "@/lib/price-units";
import { mergeUnitRegistry, type UnitDefinition } from "@/lib/unit-registry";
import type { WarehouseLaborLine } from "@/lib/warehouse-costing";
import { prisma } from "@/server/db";
import { json, numOrNull } from "@/server/db/convert";
import { nextSerial, SERIALS } from "@/server/db/serials";
import { getSystemUserId } from "@/server/db/system-user";

export type MockCommodityOption = {
  id: string;
  name: string;
  code: string;
  /** Canonical quantity unit used throughout the app (default MT). */
  unit: string;
  exchange: string | null;
  tickerCode: string | null;
  category: CommodityCategory;
  /** Kilograms per one canonical quantity unit (e.g. MT → 1000). Derived from `unit` if omitted. */
  canonicalKgPerUnit?: number | null;
  /** How this commodity is priced in each market. Falls back to canonical unit if omitted. */
  priceUnits?: CommodityPriceUnits | null;
  /** Extra booking fields specific to this commodity (merged with global + template params). */
  tradeParameterDefs?: TradeParamDefinition[] | null;
};

export type MockCounterpartyOption = {
  id: string;
  name: string;
  code: string;
  type: CounterpartyType;
  /** @deprecated single register — kept for data compatibility. */
  side: CounterpartySide;
  /** 236G rate selector (filer vs non-filer) for sales to this counterparty. */
  taxFilerStatus: TaxFilerStatus;
  country: string;
  creditLimit?: number | null;
  kycStatus: KycStatus;
  kycRef: string | null;
  kycExpires: Date | null;
  /** Legal company name as registered on NTN */
  companyNameNtn: string | null;
  ntn: string | null;
  contactPerson: string | null;
  contactPhone: string | null;
  address: string | null;
  bankDetails: string | null;
};

export type MockLocationOption = {
  id: string;
  name: string;
  code?: string | null;
  lsp?: string | null;
  address?: string | null;
  city?: string | null;
  province?: string | null;
  capacitySqFt?: number | null;
  costPerSqFt?: number | null;
  balesDivisionSqFt?: number | null;
  grainDivisionSqFt?: number | null;
  /** Warehousing service agreement start (ISO date). */
  serviceStartDate?: string | null;
  /** Estimated monthly tax on rental (PKR). */
  rentalTaxPkr?: number | null;
  /** Management fee as percentage of running cost. */
  managementFeePct?: number | null;
  /** Fixed hire period in months. */
  hiringPeriodMonths?: number | null;
  /** Fixed labor roles with headcount and monthly unit cost. */
  laborLines?: WarehouseLaborLine[] | null;
};

export { defaultCategoryForCommodityCode } from "@/lib/commodity-category";

// ─── Row mappers ─────────────────────────────────────────────────────────────

export function commodityRowToOption(row: Commodity): MockCommodityOption {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    unit: row.unit,
    exchange: row.exchange,
    tickerCode: row.tickerCode,
    category: row.category,
    canonicalKgPerUnit: numOrNull(row.canonicalKgPerUnit),
    priceUnits: json<CommodityPriceUnits>(row.priceUnits),
    tradeParameterDefs: json<TradeParamDefinition[]>(row.tradeParameterDefs),
  };
}

export function counterpartyRowToOption(row: Counterparty): MockCounterpartyOption {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    type: row.type,
    side: row.side,
    taxFilerStatus: row.taxFilerStatus,
    country: row.country,
    creditLimit: numOrNull(row.creditLimit),
    kycStatus: row.kycStatus,
    kycRef: row.kycRef,
    kycExpires: row.kycExpires,
    companyNameNtn: row.companyNameNtn,
    ntn: row.ntn,
    contactPerson: row.contactPerson,
    contactPhone: row.contactPhone,
    address: row.address,
    bankDetails: row.bankDetails,
  };
}

export function locationRowToOption(row: Location): MockLocationOption {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    lsp: row.lsp,
    address: row.address,
    city: row.city,
    province: row.province,
    capacitySqFt: numOrNull(row.capacitySqFt),
    costPerSqFt: numOrNull(row.costPerSqFt),
    balesDivisionSqFt: numOrNull(row.balesDivisionSqFt),
    grainDivisionSqFt: numOrNull(row.grainDivisionSqFt),
    serviceStartDate: row.serviceStartDate
      ? row.serviceStartDate.toISOString().slice(0, 10)
      : null,
    rentalTaxPkr: numOrNull(row.rentalTaxPkr),
    managementFeePct: numOrNull(row.managementFeePct),
    hiringPeriodMonths: row.hiringPeriodMonths,
    laborLines: json<WarehouseLaborLine[]>(row.laborLines),
  };
}

function norm(s: string) {
  return s.trim().toLowerCase();
}

/**
 * Unique counterparty business key, e.g. CP-00101. One register for all
 * counterparties — the buy/sell separation lives at LEDGER-ACCOUNT level
 * (CP-00101-B / CP-00101-S), not on the counterparty record, so inventory
 * and trades reference a single identity.
 */
export async function nextCounterpartyCode(): Promise<string> {
  return nextSerial(SERIALS.COUNTERPARTY);
}

function uniqueUnits(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const unit = value.trim();
    const key = norm(unit);
    if (!unit || seen.has(key)) continue;
    seen.add(key);
    out.push(unit);
  }
  return out;
}

async function customUnitDefs(db: Prisma.TransactionClient = prisma): Promise<UnitDefinition[]> {
  const rows = await db.unitDef.findMany();
  return rows.map((r) => ({
    code: r.code,
    kgPerUnit: Number(r.kgPerUnit),
    label: r.label ?? undefined,
  }));
}

/** All known units with kg-per-unit factors (built-in + custom). */
export async function getMergedUnitRegistry(db: Prisma.TransactionClient = prisma): Promise<Map<string, UnitDefinition>> {
  return mergeUnitRegistry(await customUnitDefs(db));
}

async function mergedQuantityUnits(db: Prisma.TransactionClient = prisma): Promise<string[]> {
  const [registry, commodities] = await Promise.all([
    getMergedUnitRegistry(db),
    db.commodity.findMany({ select: { unit: true } }),
  ]);
  return uniqueUnits([
    ...QUANTITY_UNITS,
    ...[...registry.values()].map((u) => u.code),
    ...commodities.map((c) => c.unit),
  ]);
}

/** Register or update a custom unit's kg conversion factor. */
export async function registerCustomUnit(input: {
  code: string;
  kgPerUnit: number;
  label?: string;
}, db: Prisma.TransactionClient = prisma): Promise<UnitDefinition> {
  const code = input.code.trim().toUpperCase();
  if (!code || input.kgPerUnit <= 0) {
    throw new Error("Unit code and positive kg per unit are required");
  }
  await db.unitDef.upsert({
    where: { code },
    update: { kgPerUnit: input.kgPerUnit, label: input.label ?? null },
    create: { code, kgPerUnit: input.kgPerUnit, label: input.label ?? null },
  });
  return { code, kgPerUnit: input.kgPerUnit, label: input.label };
}

async function canonicalUnit(unit: string, db: Prisma.TransactionClient = prisma): Promise<string> {
  const key = norm(unit);
  const known = await mergedQuantityUnits(db);
  return known.find((k) => norm(k) === key) ?? unit.trim();
}

// ─── Commodities ─────────────────────────────────────────────────────────────

/** Grain codes must stay in the GRAINS category (warehouse grain division). */
function categoryFor(code: string, requested?: CommodityCategory): CommodityCategory {
  if (isCornCommodity(code) || isGrainCommodityCode(code)) return CommodityCategory.GRAINS;
  return requested ?? defaultCategoryForCommodityCode(code);
}

export async function getMergedCommodities(): Promise<MockCommodityOption[]> {
  const rows = await prisma.commodity.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map(commodityRowToOption);
}

export async function getCommodityById(id: string): Promise<MockCommodityOption | undefined> {
  const row = await prisma.commodity.findUnique({ where: { id } });
  return row ? commodityRowToOption(row) : undefined;
}

export async function getCommodityByCode(code: string): Promise<MockCommodityOption | undefined> {
  const row = await prisma.commodity.findFirst({
    where: { code: { equals: code.trim(), mode: "insensitive" } },
  });
  return row ? commodityRowToOption(row) : undefined;
}

export async function addCustomCommodity(input: {
  name: string;
  code: string;
  unit: string;
  category?: CommodityCategory;
  canonicalKgPerUnit?: number | null;
  priceUnits?: CommodityPriceUnits | null;
  tradeParameterDefs?: TradeParamDefinition[] | null;
}, options: { db?: Prisma.TransactionClient; createdById?: string } = {}): Promise<MockCommodityOption> {
  const db = options.db ?? prisma;
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  const unitInput = input.unit.trim();
  if (!code || !name || !unitInput) throw new Error("Name, code, and unit are required");
  const dupe = await db.commodity.findFirst({
    where: { code: { equals: code, mode: "insensitive" } },
    select: { id: true },
  });
  if (dupe) throw new Error(`Commodity code ${code} already exists`);

  const unit = await canonicalUnit(unitInput, db);
  const kgPerCanonical = input.canonicalKgPerUnit ?? canonicalKgPerUnitOf({ unit });
  await registerCustomUnit({ code: unit, kgPerUnit: kgPerCanonical }, db);

  const row = await db.commodity.create({
    data: {
      name,
      code,
      unit,
      category: categoryFor(code, input.category),
      canonicalKgPerUnit: kgPerCanonical,
      priceUnits: (input.priceUnits ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      tradeParameterDefs: (input.tradeParameterDefs ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      createdById: options.createdById ?? await getSystemUserId(),
    },
  });
  return commodityRowToOption(row);
}

export async function deleteCustomCommodity(
  id: string,
): Promise<{ ok: boolean; code: string; name: string }> {
  const row = await prisma.commodity.findUnique({ where: { id } });
  if (!row) throw new Error("Commodity not found or cannot be deleted");
  try {
    await prisma.commodity.delete({ where: { id } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      throw new Error(
        `Commodity ${row.code} is referenced by existing trades and cannot be deleted`,
      );
    }
    throw e;
  }
  return { ok: true, code: row.code, name: row.name };
}

// ─── Grades ──────────────────────────────────────────────────────────────────

export async function getMergedGrades(): Promise<Record<string, string[]>> {
  const merged: Record<string, string[]> = {};
  for (const [code, grades] of Object.entries(DEFAULT_GRADES)) {
    merged[code] = [...grades];
  }
  const rows = await prisma.commodity.findMany({
    where: { grades: { isEmpty: false } },
    select: { code: true, grades: true },
  });
  for (const { code, grades } of rows) {
    const base = merged[code] ?? [...(DEFAULT_GRADES.default ?? [])];
    const seen = new Set(base.map(norm));
    for (const g of grades) {
      if (!seen.has(norm(g))) {
        base.push(g);
        seen.add(norm(g));
      }
    }
    merged[code] = base;
  }
  return merged;
}

export async function getGradesForCommodity(code: string): Promise<string[]> {
  const all = await getMergedGrades();
  return all[code] ?? all.default ?? [];
}

export async function addCustomGrade(commodityCode: string, grade: string): Promise<string> {
  const code = commodityCode.trim().toUpperCase();
  const g = grade.trim();
  if (!code || !g) throw new Error("Commodity code and grade are required");
  const row = await prisma.commodity.findFirst({
    where: { code: { equals: code, mode: "insensitive" } },
  });
  if (!row) throw new Error(`Commodity ${code} not found`);
  const existing = await getGradesForCommodity(code);
  if (existing.some((x) => norm(x) === norm(g))) {
    throw new Error("Grade already exists");
  }
  await prisma.commodity.update({
    where: { id: row.id },
    data: { grades: { push: g } },
  });
  return g;
}

// ─── Counterparties ──────────────────────────────────────────────────────────

export async function getMergedCounterparties(
  side?: CounterpartySide,
): Promise<MockCounterpartyOption[]> {
  const rows = await prisma.counterparty.findMany({
    where: side ? { side } : undefined,
    orderBy: { createdAt: "asc" },
  });
  return rows.map(counterpartyRowToOption);
}

export async function getCounterpartyById(
  id: string,
): Promise<MockCounterpartyOption | undefined> {
  const row = await prisma.counterparty.findUnique({ where: { id } });
  return row ? counterpartyRowToOption(row) : undefined;
}

export async function addCustomCounterparty(input: {
  name: string;
  code?: string;
  type?: CounterpartyType;
  /** @deprecated single register — ignored. */
  side?: CounterpartySide;
  taxFilerStatus?: TaxFilerStatus;
  country: string;
  kycStatus?: KycStatus;
  kycRef?: string | null;
  kycExpires?: Date | null;
  companyNameNtn?: string | null;
  ntn?: string | null;
  contactPerson?: string | null;
  contactPhone?: string | null;
  address?: string | null;
  bankDetails?: string | null;
}): Promise<MockCounterpartyOption> {
  const name = input.name.trim();
  if (!name) throw new Error("Name is required");
  // Single register — one record per party regardless of buy/sell usage.
  const dupeName = await prisma.counterparty.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { code: true },
  });
  if (dupeName) {
    throw new Error(`${name} is already registered as ${dupeName.code}`);
  }
  let code: string;
  if (input.code?.trim()) {
    code = input.code.trim().toUpperCase();
    const dupe = await prisma.counterparty.findFirst({
      where: { code: { equals: code, mode: "insensitive" } },
      select: { id: true },
    });
    if (dupe) throw new Error(`Counterparty code ${code} already exists`);
  } else {
    code = await nextCounterpartyCode();
  }
  const row = await prisma.counterparty.create({
    data: {
      name,
      code,
      type: input.type ?? CounterpartyType.TRADING_PARTNER,
      taxFilerStatus: input.taxFilerStatus ?? "FILER",
      country: input.country.trim(),
      kycStatus: input.kycStatus ?? "PENDING",
      kycRef: input.kycRef?.trim() || null,
      kycExpires: input.kycExpires ?? null,
      companyNameNtn: input.companyNameNtn?.trim() || null,
      ntn: input.ntn?.trim() || null,
      contactPerson: input.contactPerson?.trim() || null,
      contactPhone: input.contactPhone?.trim() || null,
      address: input.address?.trim() || null,
      bankDetails: input.bankDetails?.trim() || null,
      createdById: await getSystemUserId(),
    },
  });
  return counterpartyRowToOption(row);
}

export async function updateCustomCounterparty(
  id: string,
  patch: Partial<
    Pick<
      MockCounterpartyOption,
      | "name"
      | "type"
      | "country"
      | "creditLimit"
      | "kycStatus"
      | "kycRef"
      | "kycExpires"
      | "companyNameNtn"
      | "ntn"
      | "contactPerson"
      | "contactPhone"
      | "address"
      | "bankDetails"
      | "taxFilerStatus"
    >
  >,
): Promise<MockCounterpartyOption> {
  const existing = await prisma.counterparty.findUnique({ where: { id } });
  if (!existing) throw new Error("Counterparty not found or cannot be edited");
  const data: Prisma.CounterpartyUpdateInput = {};
  if (patch.name != null) {
    const name = patch.name.trim();
    if (!name) throw new Error("Counterparty name is required");
    data.name = name;
  }
  if (patch.type != null) data.type = patch.type;
  if (patch.country != null) data.country = patch.country.trim();
  if (patch.creditLimit !== undefined) data.creditLimit = patch.creditLimit;
  if (patch.kycStatus != null) data.kycStatus = patch.kycStatus;
  if (patch.kycRef !== undefined) data.kycRef = patch.kycRef?.trim() || null;
  if (patch.kycExpires !== undefined) data.kycExpires = patch.kycExpires ?? null;
  if (patch.companyNameNtn !== undefined) data.companyNameNtn = patch.companyNameNtn?.trim() || null;
  if (patch.ntn !== undefined) data.ntn = patch.ntn?.trim() || null;
  if (patch.contactPerson !== undefined) data.contactPerson = patch.contactPerson?.trim() || null;
  if (patch.contactPhone !== undefined) data.contactPhone = patch.contactPhone?.trim() || null;
  if (patch.taxFilerStatus != null) data.taxFilerStatus = patch.taxFilerStatus;
  if (patch.address !== undefined) data.address = patch.address?.trim() || null;
  if (patch.bankDetails !== undefined) data.bankDetails = patch.bankDetails?.trim() || null;

  const renamedTo = typeof data.name === "string" ? data.name : null;
  const oldName = existing.name;

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.counterparty.update({ where: { id }, data });

    // Contracts, trucks and receipts each keep their own copy of the
    // counterparty's name — snapshots taken when they were created. A rename
    // that stops at the counterparty row leaves every one of them showing the
    // old name, and matching a truck to its contract is done BY that name, so a
    // stale copy does not just look wrong, it breaks the link.
    if (renamedTo && renamedTo !== oldName) {
      const refs = (
        await tx.trade.findMany({ where: { counterpartyId: id }, select: { tradeRef: true } })
      ).map((t) => t.tradeRef);

      if (refs.length) {
        await tx.executionContract.updateMany({
          where: { tradeRef: { in: refs } },
          data: {
            counterpartyName: renamedTo,
            ...(patch.ntn !== undefined ? { counterpartyNtn: updated.ntn } : {}),
          },
        });
      }
      // These carry no counterparty id, only the name they were stamped with.
      await tx.pendingTruck.updateMany({
        where: { counterpartyName: oldName },
        data: { counterpartyName: renamedTo },
      });
      await tx.inboundReceipt.updateMany({
        where: { sellerName: oldName },
        data: { sellerName: renamedTo },
      });
      await tx.outboundDispatch.updateMany({
        where: { buyerName: oldName },
        data: { buyerName: renamedTo },
      });
      await tx.paymentRequest.updateMany({
        where: { counterpartyName: oldName },
        data: { counterpartyName: renamedTo },
      });
    } else if (patch.ntn !== undefined) {
      const refs = (
        await tx.trade.findMany({ where: { counterpartyId: id }, select: { tradeRef: true } })
      ).map((t) => t.tradeRef);
      if (refs.length) {
        await tx.executionContract.updateMany({
          where: { tradeRef: { in: refs } },
          data: { counterpartyNtn: updated.ntn },
        });
      }
    }

    return updated;
  });

  return counterpartyRowToOption(row);
}

// ─── Locations / warehouses ──────────────────────────────────────────────────

export async function getMergedLocations(): Promise<MockLocationOption[]> {
  const rows = await prisma.location.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map(locationRowToOption);
}

export async function getLocationByName(name: string): Promise<MockLocationOption | undefined> {
  const row = await prisma.location.findFirst({
    where: { name: { equals: name.trim(), mode: "insensitive" } },
  });
  return row ? locationRowToOption(row) : undefined;
}

/** True for the company's own storage warehouses (have capacity or a K-coded id) vs. ports/FOB points. */
export function isCompanyWarehouse(loc: MockLocationOption): boolean {
  return loc.capacitySqFt != null || (loc.code?.trim().toUpperCase().startsWith("K") ?? false);
}

/** Company-owned warehouses the execution head can allocate contracts to. */
export async function getCompanyWarehouses(): Promise<MockLocationOption[]> {
  return (await getMergedLocations()).filter(isCompanyWarehouse);
}

/** Next free K-code (K001, K002, …) — counter-backed, reconciled on issue. */
async function nextWarehouseCode(): Promise<string> {
  return nextSerial(SERIALS.WAREHOUSE);
}

export async function addCustomLocation(input: {
  name: string;
  code?: string;
  lsp?: string;
  address?: string;
  city?: string;
  province?: string;
  capacitySqFt?: number;
  costPerSqFt?: number;
  balesDivisionSqFt?: number;
  grainDivisionSqFt?: number;
  serviceStartDate?: string;
  rentalTaxPkr?: number;
  managementFeePct?: number;
  hiringPeriodMonths?: number;
  laborLines?: WarehouseLaborLine[];
}): Promise<MockLocationOption> {
  const n = input.name.trim();
  if (!n) throw new Error("Location name is required");
  const dupe = await prisma.location.findFirst({
    where: { name: { equals: n, mode: "insensitive" } },
    select: { id: true },
  });
  if (dupe) throw new Error("Location already exists");
  // Company warehouses (they have storage capacity) get an auto-generated
  // K-code; plain load/delivery points stay code-less.
  const code =
    input.code?.trim() ||
    (input.capacitySqFt != null ? await nextWarehouseCode() : null);
  const row = await prisma.location.create({
    data: {
      name: n,
      code,
      type: LocationType.WAREHOUSE,
      country: "Pakistan",
      lsp: input.lsp?.trim() || null,
      address: input.address?.trim() || null,
      city: input.city?.trim() || null,
      province: input.province?.trim() || null,
      capacitySqFt: input.capacitySqFt ?? null,
      costPerSqFt: input.costPerSqFt ?? null,
      // Bales division is sq ft per MT of baled goods (same metric as grain);
      // left unset unless provided — no meaningful universal default.
      balesDivisionSqFt: input.balesDivisionSqFt ?? null,
      grainDivisionSqFt: input.grainDivisionSqFt ?? 7,
      serviceStartDate: input.serviceStartDate?.trim()
        ? new Date(input.serviceStartDate.trim())
        : null,
      rentalTaxPkr: input.rentalTaxPkr ?? null,
      managementFeePct: input.managementFeePct ?? null,
      hiringPeriodMonths: input.hiringPeriodMonths ?? null,
      laborLines: (input.laborLines?.length
        ? input.laborLines
        : Prisma.JsonNull) as Prisma.InputJsonValue,
      createdById: await getSystemUserId(),
    },
  });
  return locationRowToOption(row);
}

export async function updateWarehouseLocation(
  id: string,
  patch: Partial<Omit<MockLocationOption, "id">>,
): Promise<MockLocationOption> {
  const existing = await prisma.location.findUnique({ where: { id } });
  if (!existing) throw new Error("Warehouse not found");
  const data: Prisma.LocationUpdateInput = {};
  if (patch.name !== undefined && patch.name != null) data.name = patch.name.trim();
  if (patch.code !== undefined) data.code = patch.code?.trim() || null;
  if (patch.lsp !== undefined) data.lsp = patch.lsp?.trim() || null;
  if (patch.address !== undefined) data.address = patch.address?.trim() || null;
  if (patch.city !== undefined) data.city = patch.city?.trim() || null;
  if (patch.province !== undefined) data.province = patch.province?.trim() || null;
  if (patch.capacitySqFt !== undefined) data.capacitySqFt = patch.capacitySqFt;
  if (patch.costPerSqFt !== undefined) data.costPerSqFt = patch.costPerSqFt;
  if (patch.balesDivisionSqFt !== undefined) data.balesDivisionSqFt = patch.balesDivisionSqFt;
  if (patch.grainDivisionSqFt !== undefined) data.grainDivisionSqFt = patch.grainDivisionSqFt;
  if (patch.serviceStartDate !== undefined) {
    data.serviceStartDate = patch.serviceStartDate?.trim()
      ? new Date(patch.serviceStartDate.trim())
      : null;
  }
  if (patch.rentalTaxPkr !== undefined) data.rentalTaxPkr = patch.rentalTaxPkr;
  if (patch.managementFeePct !== undefined) data.managementFeePct = patch.managementFeePct;
  if (patch.hiringPeriodMonths !== undefined) data.hiringPeriodMonths = patch.hiringPeriodMonths;
  if (patch.laborLines !== undefined) {
    data.laborLines = (patch.laborLines?.length
      ? patch.laborLines
      : Prisma.JsonNull) as Prisma.InputJsonValue;
  }
  const row = await prisma.location.update({ where: { id }, data });
  return locationRowToOption(row);
}

export async function deleteWarehouseLocation(id: string): Promise<{ ok: boolean; name: string }> {
  const row = await prisma.location.findUnique({ where: { id } });
  if (!row) throw new Error("Warehouse not found");
  try {
    await prisma.location.delete({ where: { id } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      throw new Error(
        `Warehouse ${row.name} is referenced by existing records and cannot be deleted`,
      );
    }
    throw e;
  }
  return { ok: true, name: row.name };
}

// ─── Reference data bundle ───────────────────────────────────────────────────

export async function getTraderReferenceData() {
  const [commodities, counterparties, locations, quantityUnits, registry, grades, warehouses] =
    await Promise.all([
      getMergedCommodities(),
      getMergedCounterparties(),
      getMergedLocations(),
      mergedQuantityUnits(),
      getMergedUnitRegistry(),
      getMergedGrades(),
      getCompanyWarehouses(),
    ]);

  return {
    commodities,
    counterparties,
    /** Single register — both lists are the full set (kept for UI compat). */
    buyCounterparties: counterparties,
    sellCounterparties: counterparties,
    locations,
    incoterms: [...INCOTERMS],
    incotermsByDirection: {
      BUY: [...incotermsForDirection("BUY")],
      SELL: [...incotermsForDirection("SELL")],
    },
    quantityUnits,
    units: [...registry.values()].sort((a, b) => a.code.localeCompare(b.code)),
    priceCurrencies: [...PRICE_CURRENCIES],
    priceWeightUnits: uniqueUnits([...PRICE_WEIGHT_UNITS, ...quantityUnits]),
    grades,
    /** Company warehouses registered on Execution → Warehouses (for booking dropdown). */
    companyWarehouses: warehouses.map((w) => ({
      id: w.id,
      name: w.name,
      code: w.code ?? null,
    })),
  };
}

/** Resolve the price basis for a commodity id + market scope (server-side). */
export async function getCommodityPriceBasis(
  commodityId: string,
  scope: "LOCAL" | "INTERNATIONAL",
): Promise<PriceBasis> {
  return resolvePriceBasis(await getCommodityById(commodityId), scope);
}
