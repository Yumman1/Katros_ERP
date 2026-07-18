/**
 * Kastros CTRM — idempotent database seed.
 *
 * Run with: npm run db:seed   (tsx prisma/seed.ts, DATABASE_URL from env)
 *
 * Every entity is upserted by its unique business key (email / code / name),
 * so the script is safe to re-run against a live database.
 */
import "dotenv/config";
import {
  Prisma,
  PrismaClient,
  Role,
  CommodityCategory,
  LocationType,
} from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const d = (n: number | string) => new Prisma.Decimal(n);

const DEFAULT_PASSWORD = "Kastros123!";

// ─── Users ────────────────────────────────────────────────────────────────────

type UserSeed = {
  email: string;
  name: string;
  role: Role;
  isHead: boolean;
};

const USERS: UserSeed[] = [
  { email: "admin@kastros.com", name: "Kastros Admin", role: Role.ADMIN, isHead: true },
  { email: "ceo@kastros.com", name: "Executive Office", role: Role.CEO, isHead: true },
  { email: "trader@kastros.com", name: "Ayesha Malik", role: Role.TRADER, isHead: false },
  { email: "traderhead@kastros.com", name: "Trader Head", role: Role.TRADER, isHead: true },
  { email: "execution@kastros.com", name: "Asad Hussain", role: Role.EXECUTION, isHead: false },
  { email: "executionhead@kastros.com", name: "Execution Head", role: Role.EXECUTION, isHead: true },
  { email: "finance@kastros.com", name: "Sana Rizvi", role: Role.FINANCE, isHead: false },
  { email: "financehead@kastros.com", name: "Finance Head", role: Role.FINANCE, isHead: true },
  { email: "risk@kastros.com", name: "Omar Khan", role: Role.RISK_MANAGER, isHead: false },
  { email: "viewer@kastros.com", name: "Read Only User", role: Role.READ_ONLY, isHead: false },
];

async function seedUsers() {
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
  const users = [];
  for (const u of USERS) {
    users.push(
      await prisma.user.upsert({
        where: { email: u.email },
        create: { email: u.email, passwordHash, name: u.name, role: u.role, isHead: u.isHead },
        update: { name: u.name, role: u.role, isHead: u.isHead },
      }),
    );
  }
  return users;
}

// ─── Commodities ─────────────────────────────────────────────────────────────

type CommoditySeed = {
  name: string;
  code: string;
  unit: string;
  exchange?: string;
  tickerCode?: string;
  category: CommodityCategory;
  canonicalKgPerUnit: number;
  grades: string[];
  /** { LOCAL, INTERNATIONAL } price bases — currency / weight unit / kg factor. */
  priceUnits?: Prisma.InputJsonValue;
};

const localMaund = { currency: "PKR", weightUnit: "MAUND_40", kgPerUnit: 40 };
const intlMt = { currency: "USD", weightUnit: "MT", kgPerUnit: 1000 };

const COMMODITIES: CommoditySeed[] = [
  {
    name: "Corn (Maize)",
    code: "CORN",
    unit: "MT",
    exchange: "CBOT",
    tickerCode: "ZC",
    category: CommodityCategory.GRAINS,
    canonicalKgPerUnit: 1000,
    grades: ["Grade A", "Grade B", "Feed Grade"],
    priceUnits: { LOCAL: localMaund, INTERNATIONAL: intlMt },
  },
];

async function seedCommodities(adminId: string) {
  const rows = [];
  for (const c of COMMODITIES) {
    const data = {
      name: c.name,
      unit: c.unit,
      exchange: c.exchange ?? null,
      tickerCode: c.tickerCode ?? null,
      category: c.category,
      canonicalKgPerUnit: d(c.canonicalKgPerUnit),
      grades: c.grades,
      priceUnits: c.priceUnits ?? Prisma.JsonNull,
    };
    rows.push(
      await prisma.commodity.upsert({
        where: { code: c.code },
        create: { code: c.code, ...data, createdById: adminId },
        update: data,
      }),
    );
  }
  return rows;
}

// ─── Unit definitions ────────────────────────────────────────────────────────
// MT (1000 kg), KG (1 kg) and MAUND_40 (40 kg) are built into
// lib/unit-registry.ts / lib/price-units.ts — only seed units the built-in
// registry does NOT ship with.

const UNIT_DEFS = [
  { code: "BAG_50", label: "BAG (50 kg)", kgPerUnit: 50 },
  { code: "BAG_100", label: "BAG (100 kg)", kgPerUnit: 100 },
];

async function seedUnitDefs() {
  for (const u of UNIT_DEFS) {
    await prisma.unitDef.upsert({
      where: { code: u.code },
      create: { code: u.code, label: u.label, kgPerUnit: d(u.kgPerUnit) },
      update: { label: u.label, kgPerUnit: d(u.kgPerUnit) },
    });
  }
  return UNIT_DEFS.length;
}

// ─── Locations (Kastros company warehouses + port) ───────────────────────────
// Ported from scripts/seed-kastros-warehouses.ts (master spreadsheet data).

type WarehouseSeed = {
  name: string;
  code: string;
  lsp: string;
  address: string | null;
  city: string;
  province: string;
  capacitySqFt: number;
  costPerSqFt: number | null;
  balesDivisionSqFt: number;
  grainDivisionSqFt: number;
};

const KASTROS_WAREHOUSES: WarehouseSeed[] = [
  {
    name: "K001-Al Amin WH SWL",
    code: "K001",
    lsp: "Hellmann",
    address: "12 KM Sahiwal Arifwala, Bahawalnagar Road Sahiwal",
    city: "Sahiwal",
    province: "Punjab",
    capacitySqFt: 38680,
    costPerSqFt: 36,
    balesDivisionSqFt: 4.5,
    grainDivisionSqFt: 6.041,
  },
  {
    name: "K002-Abdullah wh",
    code: "K002",
    lsp: "Hellmann",
    address: "Abdullah textile mill, Chak No 85/15L vehari Road khanewal",
    city: "Kacha Koh",
    province: "Punjab",
    capacitySqFt: 70000,
    costPerSqFt: 25,
    balesDivisionSqFt: 4,
    grainDivisionSqFt: 10.311,
  },
  {
    name: "K003-Galaxy wh",
    code: "K003",
    lsp: "Hellmann",
    address: "30km Sheikhupura Road Khuriwala FSB Punjab pakistan",
    city: "Jhang",
    province: "Punjab",
    capacitySqFt: 100000,
    costPerSqFt: 28,
    balesDivisionSqFt: 4.5,
    grainDivisionSqFt: 7.2,
  },
  {
    name: "K004-Hussain Wh",
    code: "K004",
    lsp: "Hellmann",
    address: "Galaxy textile mill Madhuki road near old bypass jhang",
    city: "Kabirwala",
    province: "Punjab",
    capacitySqFt: 10000,
    costPerSqFt: 16,
    balesDivisionSqFt: 4.5,
    grainDivisionSqFt: 8.067,
  },
  {
    name: "K005-Shuja feed Wh",
    code: "K005",
    lsp: "Moventis",
    address: "Shujaabad Feed, Jalalpur",
    city: "Jalalpur",
    province: "Punjab",
    capacitySqFt: 53000,
    costPerSqFt: 18,
    balesDivisionSqFt: 4,
    grainDivisionSqFt: 7.5,
  },
  {
    name: "K006-Faysal Wh",
    code: "K006",
    lsp: "Moventis",
    address: "17 KM khanewal mouza kohi wala kabirwala",
    city: "Faisalabad",
    province: "Punjab",
    capacitySqFt: 25000,
    costPerSqFt: 19,
    balesDivisionSqFt: 4.5,
    grainDivisionSqFt: 6.8,
  },
  {
    name: "K008-Al-Amin Wh (Kotri)",
    code: "K008",
    lsp: "Hellmann",
    address: null,
    city: "Kotri",
    province: "Sindh",
    capacitySqFt: 38000,
    costPerSqFt: null,
    balesDivisionSqFt: 3.878,
    grainDivisionSqFt: 8,
  },
  {
    name: "K009-Kohisar Wh (Kotri)",
    code: "K009",
    lsp: "Hellmann",
    address: null,
    city: "Kotri",
    province: "Sindh",
    capacitySqFt: 24000,
    costPerSqFt: null,
    balesDivisionSqFt: 3.627,
    grainDivisionSqFt: 8,
  },
  {
    name: "K010-Fatima wh MG",
    code: "K010",
    lsp: "Moventis",
    address: null,
    city: "MuzaffarGarh",
    province: "Punjab",
    capacitySqFt: 36000,
    costPerSqFt: null,
    balesDivisionSqFt: 3.375,
    grainDivisionSqFt: 8,
  },
];

async function seedLocations(adminId: string) {
  const rows = [];
  for (const w of KASTROS_WAREHOUSES) {
    const data = {
      code: w.code,
      type: LocationType.WAREHOUSE,
      country: "Pakistan",
      lsp: w.lsp,
      address: w.address,
      city: w.city,
      province: w.province,
      capacitySqFt: d(w.capacitySqFt),
      costPerSqFt: w.costPerSqFt != null ? d(w.costPerSqFt) : null,
      balesDivisionSqFt: d(w.balesDivisionSqFt),
      grainDivisionSqFt: d(w.grainDivisionSqFt),
    };
    rows.push(
      await prisma.location.upsert({
        where: { name: w.name },
        create: { name: w.name, ...data, createdById: adminId },
        update: data,
      }),
    );
  }

  // Port of discharge used by international trades.
  rows.push(
    await prisma.location.upsert({
      where: { name: "Port Qasim" },
      create: {
        name: "Port Qasim",
        code: "PQ",
        type: LocationType.PORT,
        country: "Pakistan",
        lsp: "Hellmann",
        address: "Port Qasim, Karachi",
        city: "Karachi",
        province: "Sindh",
        createdById: adminId,
      },
      update: { code: "PQ", type: LocationType.PORT, country: "Pakistan" },
    }),
  );
  return rows;
}

// ─── Reference counters ──────────────────────────────────────────────────────
// 'trade' starts at 10020 so the first booked trade ref is KAS-<year>-10021.
// Other counters (kcs, gatepass, change-request, …) are created lazily at 0
// by server/db/counters.ts — only the trade counter needs a head start.
// Upserts use an empty update so a live counter is never wound back.

async function seedRefCounters() {
  await prisma.refCounter.upsert({
    where: { name: "trade" },
    create: { name: "trade", value: BigInt(10020) },
    update: {},
  });
  await prisma.refCounter.upsert({
    where: { name: "change-request" },
    create: { name: "change-request", value: BigInt(0) },
    update: {},
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const users = await seedUsers();
  const admin = users.find((u) => u.email === "admin@kastros.com");
  if (!admin) throw new Error("admin@kastros.com missing after user seed");

  const commodities = await seedCommodities(admin.id);
  const unitCount = await seedUnitDefs();
  const locations = await seedLocations(admin.id);
  await seedRefCounters();

  console.log("── Kastros seed complete ─────────────────────────────");
  console.log(`Users:          ${users.length} (password: ${DEFAULT_PASSWORD})`);
  console.log(`Commodities:    ${commodities.length} (${commodities.map((c) => c.code).join(", ")})`);
  console.log(`Unit defs:      ${unitCount} custom (${UNIT_DEFS.map((u) => u.code).join(", ")})`);
  console.log(`Locations:      ${locations.length} (${KASTROS_WAREHOUSES.length} warehouses + Port Qasim)`);
  console.log("RefCounters:    trade=10020 (next ref KAS-<year>-10021), change-request=0");
  console.log("Login:          admin@kastros.com / " + DEFAULT_PASSWORD);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
