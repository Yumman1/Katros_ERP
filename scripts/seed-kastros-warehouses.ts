/**
 * One-time seed: register Kastros company warehouses from master spreadsheet.
 * Run: npx tsx scripts/seed-kastros-warehouses.ts
 */
import fs from "fs";
import superjson from "superjson";
import path from "path";

const MASTER = path.join(process.cwd(), "data", "local", "master-data.json");

type Loc = {
  id: string;
  name: string;
  code: string | null;
  lsp: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  capacitySqFt: number | null;
  costPerSqFt: number | null;
  balesDivisionSqFt: number;
  grainDivisionSqFt: number;
};

const KASTROS_WAREHOUSES: Omit<Loc, "id">[] = [
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

function norm(s: string) {
  return s.trim().toLowerCase();
}

const raw = fs.readFileSync(MASTER, "utf8");
const parsed = superjson.parse(raw) as {
  customLocations: Loc[];
  customLocationSeq: number;
  [key: string]: unknown;
};

const existing = parsed.customLocations ?? [];
const ports = existing.filter(
  (l) => l.name === "Kuala Lumpur Port" || l.name === "Port Qasim",
);

const portQasim = ports.find((l) => l.name === "Port Qasim");
if (portQasim) {
  portQasim.code = "PQ";
  portQasim.lsp = "Hellmann";
  portQasim.address = portQasim.address?.trim() === "NA NA" ? "Port Qasim, Karachi" : portQasim.address;
}

const kualaLumpur = ports.find((l) => l.name === "Kuala Lumpur Port") ?? existing.find((l) => l.name === "Kuala Lumpur Port");

const merged: Loc[] = [];
if (kualaLumpur) merged.push(kualaLumpur);
if (portQasim) merged.push(portQasim);

let seq = parsed.customLocationSeq ?? existing.length;
for (const wh of KASTROS_WAREHOUSES) {
  const hit = existing.find((l) => norm(l.name) === norm(wh.name) || l.code === wh.code);
  if (hit) {
    merged.push({ ...hit, ...wh, id: hit.id });
    continue;
  }
  seq += 1;
  merged.push({ id: `cl-${seq}`, ...wh });
}

parsed.customLocations = merged;
parsed.customLocationSeq = Math.max(seq, merged.length);

const tmp = `${MASTER}.${process.pid}.tmp`;
fs.writeFileSync(tmp, superjson.stringify(parsed), "utf8");
fs.renameSync(tmp, MASTER);

console.log(`Registered ${KASTROS_WAREHOUSES.length} Kastros warehouses (${merged.length} total locations).`);
for (const w of merged.filter((l) => l.code?.startsWith("K"))) {
  console.log(`  ${w.code} · ${w.name} · ${w.capacitySqFt?.toLocaleString()} sq ft · ${w.lsp}`);
}
