import { subDays, addDays } from "date-fns";
import {
  getMergedCommodities,
  getMergedCounterparties,
  getMergedLocations,
} from "@/server/trader-master-data";
import { canonicalTraderName, traderNamesMatch } from "@/lib/trader-identity";
import {
  isLocalPersistEnabled,
  readPersisted,
  TRADES_FILE,
  writePersisted,
} from "@/server/local-persist";
import {
  CashFlowType,
  InventoryStatus,
  InvoiceStatus,
  MovementType,
  ReconStatus,
  ReconType,
  TradeDirection,
  TradeStatus,
  TraceEventType,
  Role,
  LocationType,
} from "@prisma/client";

const now = () => new Date();

/** SSE / ticker */
export function mockPriceTickerPayload() {
  return [
    { code: "WHT", price: 281.4, ccy: "USD", asOf: now().toISOString() },
    { code: "CPO", price: 935.2, ccy: "USD", asOf: now().toISOString() },
    { code: "SUG", price: 468.75, ccy: "USD", asOf: now().toISOString() },
    { code: "CTN", price: 1825.0, ccy: "USD", asOf: now().toISOString() },
    { code: "COF", price: 3088.0, ccy: "USD", asOf: now().toISOString() },
    { code: "SOY", price: 441.25, ccy: "USD", asOf: now().toISOString() },
    { code: "RCE", price: 518.0, ccy: "USD", asOf: now().toISOString() },
    { code: "CRN", price: 201.5, ccy: "USD", asOf: now().toISOString() },
  ];
}

export function mockCredentialsUser(email: string) {
  const e = email.toLowerCase();
  const role =
    e.includes("risk") ? Role.RISK_MANAGER
    : e.includes("finance") ? Role.FINANCE
    : e.includes("trader") ? Role.TRADER
    : e.includes("execution") ? Role.EXECUTION
    : e.includes("view") || e.includes("read") ? Role.READ_ONLY
    : Role.ADMIN;
  const name =
    role === Role.TRADER ? "Ayesha Malik"
    : role === Role.EXECUTION ? "Asad Hussain"
    : role === Role.RISK_MANAGER ? "Omar Khan"
    : role === Role.FINANCE ? "Sana Rizvi"
    : role === Role.READ_ONLY ? "Read Only User"
    : "Kastros Admin";
  return {
    id:
      role === Role.TRADER
        ? "mock-trader-1"
        : role === Role.EXECUTION
          ? "mock-execution-1"
          : "mock-user-1",
    email: e,
    name,
    role,
  };
}

export function mockPositionsSummaryCards() {
  return [
    {
      commodityId: "c1",
      code: "WHT",
      name: "Wheat",
      longQty: 12400,
      shortQty: 8200,
      netQty: 4200,
      avgBuyPrice: 276.5,
      avgSellPrice: 279.2,
      marketPrice: 281.4,
      dayChangePct: 0.0082,
    },
    {
      commodityId: "c2",
      code: "CPO",
      name: "Palm Oil",
      longQty: 3200,
      shortQty: 5100,
      netQty: -1900,
      avgBuyPrice: 910.0,
      avgSellPrice: 928.0,
      marketPrice: 935.2,
      dayChangePct: -0.0031,
    },
    {
      commodityId: "c3",
      code: "SUG",
      name: "Sugar",
      longQty: 8800,
      shortQty: 8800,
      netQty: 0,
      avgBuyPrice: 462.0,
      avgSellPrice: 464.5,
      marketPrice: 468.75,
      dayChangePct: 0.011,
    },
  ];
}

export function mockExposureSummary() {
  return {
    totalLong: 28400,
    totalShort: 23100,
    netExposure: 5300,
    netMTM: 128_450.75,
    asOf: now().toISOString(),
  };
}

export function mockPositionBook(commodityId?: string) {
  const rows = [
    {
      id: "leg-1",
      commodity: "WHT",
      commodityName: "Wheat",
      direction: "BUY" as const,
      quantity: 5000,
      bookPrice: 275.0,
      marketPrice: 281.4,
      mtmPnl: 32_000,
      unrealizedPnl: 32_000,
      pctChange: 0.008,
      bookValue: 1_375_000,
      marketValue: 1_407_000,
      currency: "USD",
      tradeRef: "KAS-2026-10001",
      counterparty: "Sindh Mills Corp",
      updatedAt: now().toISOString(),
    },
    {
      id: "leg-2",
      commodity: "CPO",
      commodityName: "Palm Oil",
      direction: "SELL" as const,
      quantity: 1200,
      bookPrice: 940.0,
      marketPrice: 935.2,
      mtmPnl: 5760,
      unrealizedPnl: 5760,
      pctChange: -0.002,
      bookValue: 1_128_000,
      marketValue: 1_122_240,
      currency: "USD",
      tradeRef: "KAS-2026-10002",
      counterparty: "Al Ghurair Resources",
      updatedAt: now().toISOString(),
    },
    {
      id: "leg-3",
      commodity: "SUG",
      commodityName: "Sugar",
      direction: "BUY" as const,
      quantity: 2400,
      bookPrice: 460.0,
      marketPrice: 468.75,
      mtmPnl: 21_000,
      unrealizedPnl: 21_000,
      pctChange: 0.012,
      bookValue: 1_104_000,
      marketValue: 1_125_000,
      currency: "PKR",
      tradeRef: "KAS-2026-10003",
      counterparty: "National Foods",
      updatedAt: now().toISOString(),
    },
  ];
  if (!commodityId) return rows;
  const map: Record<string, string> = { c1: "WHT", c2: "CPO", c3: "SUG" };
  const code = map[commodityId];
  return code ? rows.filter((r) => r.commodity === code) : rows;
}

export function mockMtmBook(opts?: { commodityId?: string; sign?: "pos" | "neg" | "all" }) {
  const book = mockPositionBook(opts?.commodityId);
  const rows = book.map((r) => ({
    tradeRef: r.tradeRef,
    commodity: r.commodity,
    qty: r.quantity,
    direction: r.direction,
    bookPrice: r.bookPrice,
    marketPrice: r.marketPrice,
    mtmPnl: r.mtmPnl,
    unrealizedPnl: r.unrealizedPnl,
    valueDate: now().toISOString(),
    currency: r.currency,
    counterparty: r.counterparty,
  }));
  const filtered =
    opts?.sign === "pos" ? rows.filter((r) => r.mtmPnl >= 0)
    : opts?.sign === "neg" ? rows.filter((r) => r.mtmPnl < 0)
    : rows;
  const totalUnrealizedPnl = filtered.reduce((a, r) => a + r.unrealizedPnl, 0);
  return { rows: filtered, totalUnrealizedPnl, openCount: filtered.length };
}

export function mockMtmHistory(days: number) {
  const end = new Date();
  const pts: { date: string; total: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = subDays(end, i);
    pts.push({
      date: d.toISOString(),
      total: 95_000 + Math.sin(i / 5) * 12_000 + i * 400,
    });
  }
  return pts;
}

export function mockPnlAttribution() {
  return {
    totalPnl: 412_880.5,
    priceEffect: 298_400,
    volumeEffect: 87_200,
    fxEffect: 27_280.5,
    other: 0,
    rows: [
      {
        tradeRef: "KAS-2026-10001",
        commodity: "WHT",
        direction: "BUY",
        source: "PRICE_EFFECT",
        amount: 45_200,
        currency: "USD",
      },
      {
        tradeRef: "KAS-2026-10002",
        commodity: "CPO",
        direction: "SELL",
        source: "PRICE_EFFECT",
        amount: -12_400,
        currency: "USD",
      },
      {
        tradeRef: "KAS-2026-10003",
        commodity: "SUG",
        direction: "BUY",
        source: "PRICE_EFFECT",
        amount: 18_900,
        currency: "PKR",
      },
    ],
  };
}

export function mockCashflowList(projectedOnly?: boolean | null) {
  let entries = [
    {
      id: "cf1",
      entryDate: subDays(now(), 5),
      valueDate: subDays(now(), 3),
      entryType: CashFlowType.TRADE_RECEIPT,
      amount: 1_250_000,
      currency: "USD",
      description: "Wheat export — TT settlement",
      tradeRef: "KAS-2026-10001",
      invoiceRef: null as string | null,
      isProjected: false,
      isPaid: true,
    },
    {
      id: "cf2",
      entryDate: subDays(now(), 2),
      valueDate: subDays(now(), 1),
      entryType: CashFlowType.TRADE_PAYMENT,
      amount: -890_000,
      currency: "USD",
      description: "Palm oil cargo — supplier payment",
      tradeRef: "KAS-2026-10002",
      invoiceRef: null as string | null,
      isProjected: false,
      isPaid: true,
    },
    {
      id: "cf3",
      entryDate: now(),
      valueDate: subDays(now(), -7),
      entryType: CashFlowType.FINANCING,
      amount: -125_000,
      currency: "PKR",
      description: "Revolving facility — interest",
      tradeRef: null as string | null,
      invoiceRef: null as string | null,
      isProjected: true,
      isPaid: false,
    },
  ];
  if (projectedOnly === true) entries = entries.filter((e) => e.isProjected);
  if (projectedOnly === false) entries = entries.filter((e) => !e.isProjected);
  let bal = 0;
  const rows = entries.map((e) => {
    bal += e.amount;
    return {
      id: e.id,
      valueDate: e.valueDate.toISOString(),
      entryDate: e.entryDate.toISOString(),
      type: e.entryType,
      description: e.description,
      amount: e.amount,
      currency: e.currency,
      running: bal,
      isProjected: e.isProjected,
      isPaid: e.isPaid,
      tradeRef: e.tradeRef,
    };
  });
  const receipts = entries.filter((e) => e.amount > 0).reduce((a, e) => a + e.amount, 0);
  const payments = entries.filter((e) => e.amount < 0).reduce((a, e) => a + e.amount, 0);
  return {
    rows,
    summary: { receipts, payments, net: receipts + payments, opening: 0, closing: bal },
  };
}

export function mockUpcomingInvoices() {
  return [
    {
      id: "inv1",
      invoiceRef: "INV-2026-5102",
      amount: 640_000,
      currency: "USD",
      dueDate: subDays(now(), -5),
      status: InvoiceStatus.SENT,
      counterparty: { name: "Engro Grain Terminal", code: "EGT" },
      trade: { tradeRef: "KAS-2026-10004" },
    },
    {
      id: "inv2",
      invoiceRef: "INV-2026-5108",
      amount: 2_100_000,
      currency: "PKR",
      dueDate: subDays(now(), -2),
      status: InvoiceStatus.OVERDUE,
      counterparty: { name: "FFC Agricultural", code: "FFC" },
      trade: { tradeRef: "KAS-2026-10005" },
    },
  ];
}

export function mockReconciliationList(filter?: { type?: ReconType; status?: ReconStatus }) {
  const all = [
    {
      id: "r1",
      reconDate: subDays(now(), 2),
      reconType: ReconType.TRADE_VS_INVOICE,
      referenceA: "KAS-2026-10001",
      referenceB: "INV-2026-5001",
      expectedAmount: 1_375_000,
      actualAmount: 1_375_000,
      difference: 0,
      status: ReconStatus.MATCHED,
      notes: null as string | null,
    },
    {
      id: "r2",
      reconDate: subDays(now(), 4),
      reconType: ReconType.INVOICE_VS_PAYMENT,
      referenceA: "INV-2026-5002",
      referenceB: "PAY-88921",
      expectedAmount: 890_000,
      actualAmount: 875_000,
      difference: -15_000,
      status: ReconStatus.BREAK,
      notes: "FX rounding variance",
    },
    {
      id: "r3",
      reconDate: subDays(now(), 1),
      reconType: ReconType.POSITION_VS_INVENTORY,
      referenceA: "POS-WHT-KHI",
      referenceB: "INV-LOC-12",
      expectedAmount: 12_400,
      actualAmount: 12_350,
      difference: -50,
      status: ReconStatus.PENDING_REVIEW,
      notes: null as string | null,
    },
  ];
  return all.filter(
    (r) =>
      (!filter?.type || r.reconType === filter.type) &&
      (!filter?.status || r.status === filter.status),
  );
}

export function mockReconciliationSummary() {
  return { matched: 42, break: 7, pending: 3, resolved: 18, total: 70 };
}

export function mockAutoReconcile() {
  return { matched: 38, breaks: 9, message: "Auto-match scan complete (mock data)" };
}

export type ShipmentStatus =
  | "PLANNED"
  | "LOADING"
  | "IN_TRANSIT"
  | "AT_PORT"
  | "DELIVERED"
  | "DELAYED"
  | "CANCELLED";

export function mockInventorySummary() {
  return [
    { code: "WHT", onHand: 18_200, reserved: 1200, transit: 800, value: 5_120_000 },
    { code: "CPO", onHand: 4200, reserved: 400, transit: 600, value: 3_930_000 },
    { code: "SUG", onHand: 9600, reserved: 0, transit: 400, value: 4_500_000 },
    { code: "SOY", onHand: 3400, reserved: 200, transit: 0, value: 1_490_000 },
    { code: "RCE", onHand: 2100, reserved: 150, transit: 300, value: 1_088_000 },
  ];
}

const mockCommodity = { id: "c1", code: "WHT", name: "Wheat", unit: "MT" };
const mockLocation = { id: "l1", name: "Karachi Warehouse", type: LocationType.WAREHOUSE };

export function mockInventoryList(locationId?: string, commodityId?: string, status?: InventoryStatus) {
  const rows = [
    {
      id: "i1",
      commodityId: "c1",
      locationId: "l1",
      quantity: 8200,
      unit: "MT",
      valuationPrice: 281.4,
      totalValue: 2_307_480,
      qualityGrade: "Grade A",
      warehouseRef: "WH-KHI-101",
      arrivalDate: subDays(now(), 30),
      expiryDate: addDays(now(), 335),
      status: InventoryStatus.IN_STOCK,
      reservedQty: 500,
      inTransitQty: 200,
      updatedAt: now(),
      commodity: mockCommodity,
      location: mockLocation,
    },
    {
      id: "i2",
      commodityId: "c2",
      locationId: "l2",
      quantity: 2100,
      unit: "MT",
      valuationPrice: 935.2,
      totalValue: 1_963_920,
      qualityGrade: "FAQ",
      warehouseRef: "WH-LHE-204",
      arrivalDate: subDays(now(), 12),
      expiryDate: addDays(now(), 180),
      status: InventoryStatus.TRANSIT,
      reservedQty: 0,
      inTransitQty: 2100,
      updatedAt: now(),
      commodity: { id: "c2", code: "CPO", name: "Palm Oil", unit: "MT" },
      location: { id: "l2", name: "Lahore Warehouse", type: LocationType.WAREHOUSE },
    },
    {
      id: "i3",
      commodityId: "c1",
      locationId: "l3",
      quantity: 4500,
      unit: "MT",
      valuationPrice: 279.8,
      totalValue: 1_259_100,
      qualityGrade: "Grade A",
      warehouseRef: "SIL-MUL-088",
      arrivalDate: subDays(now(), 45),
      expiryDate: addDays(now(), 320),
      status: InventoryStatus.IN_STOCK,
      reservedQty: 700,
      inTransitQty: 0,
      updatedAt: now(),
      commodity: mockCommodity,
      location: { id: "l3", name: "Multan Silo Cluster", type: LocationType.SILO },
    },
    {
      id: "i4",
      commodityId: "c3",
      locationId: "l1",
      quantity: 3200,
      unit: "MT",
      valuationPrice: 468.75,
      totalValue: 1_500_000,
      qualityGrade: "VHP",
      warehouseRef: "WH-KHI-118",
      arrivalDate: subDays(now(), 8),
      expiryDate: addDays(now(), 540),
      status: InventoryStatus.RESERVED,
      reservedQty: 3200,
      inTransitQty: 0,
      updatedAt: now(),
      commodity: { id: "c3", code: "SUG", name: "Sugar", unit: "MT" },
      location: mockLocation,
    },
    {
      id: "i5",
      commodityId: "c6",
      locationId: "l4",
      quantity: 1800,
      unit: "MT",
      valuationPrice: 441.25,
      totalValue: 794_250,
      qualityGrade: "No.2 Yellow",
      warehouseRef: "PORT-KHI-B12",
      arrivalDate: subDays(now(), 3),
      expiryDate: addDays(now(), 270),
      status: InventoryStatus.IN_STOCK,
      reservedQty: 200,
      inTransitQty: 600,
      updatedAt: now(),
      commodity: { id: "c6", code: "SOY", name: "Soybeans", unit: "MT" },
      location: { id: "l4", name: "Karachi Port", type: LocationType.PORT },
    },
    {
      id: "i6",
      commodityId: "c7",
      locationId: "l5",
      quantity: 1200,
      unit: "MT",
      valuationPrice: 518.0,
      totalValue: 621_600,
      qualityGrade: "Basmati 1121",
      warehouseRef: "PQ-STOR-07",
      arrivalDate: subDays(now(), 18),
      expiryDate: addDays(now(), 730),
      status: InventoryStatus.IN_STOCK,
      reservedQty: 150,
      inTransitQty: 300,
      updatedAt: now(),
      commodity: { id: "c7", code: "RCE", name: "Rice", unit: "MT" },
      location: { id: "l5", name: "Port Qasim", type: LocationType.PORT },
    },
    {
      id: "i7",
      commodityId: "c2",
      locationId: "l4",
      quantity: 900,
      unit: "MT",
      valuationPrice: 932.0,
      totalValue: 838_800,
      qualityGrade: "CP8",
      warehouseRef: "PORT-KHI-T04",
      arrivalDate: subDays(now(), 55),
      expiryDate: addDays(now(), 125),
      status: InventoryStatus.IN_STOCK,
      reservedQty: 0,
      inTransitQty: 0,
      updatedAt: now(),
      commodity: { id: "c2", code: "CPO", name: "Palm Oil", unit: "MT" },
      location: { id: "l4", name: "Karachi Port", type: LocationType.PORT },
    },
    {
      id: "i8",
      commodityId: "c1",
      locationId: "l2",
      quantity: 5500,
      unit: "MT",
      valuationPrice: 280.5,
      totalValue: 1_542_750,
      qualityGrade: "Grade B",
      warehouseRef: "WH-LHE-311",
      arrivalDate: subDays(now(), 72),
      expiryDate: addDays(now(), 293),
      status: InventoryStatus.IN_STOCK,
      reservedQty: 0,
      inTransitQty: 0,
      updatedAt: now(),
      commodity: mockCommodity,
      location: { id: "l2", name: "Lahore Warehouse", type: LocationType.WAREHOUSE },
    },
  ];
  return rows.filter(
    (r) =>
      (!locationId || r.locationId === locationId) &&
      (!commodityId || r.commodityId === commodityId) &&
      (!status || r.status === status),
  );
}

export function mockInventoryMovements(inventoryId?: string) {
  const inv = mockInventoryList()[0];
  const all = [
    {
      id: "m1",
      inventoryId: "i1",
      movementType: MovementType.IN,
      quantity: 1000,
      movementDate: subDays(now(), 10),
      reference: "GRN-SEA-44",
      notes: "Vessel discharge — MV Pacific Grain",
      inventory: inv,
    },
    {
      id: "m2",
      inventoryId: "i1",
      movementType: MovementType.OUT,
      quantity: 400,
      movementDate: subDays(now(), 3),
      reference: "OUT-DOM-12",
      notes: "Local mill offtake — National Foods",
      inventory: inv,
    },
    {
      id: "m3",
      inventoryId: "i1",
      movementType: MovementType.TRANSFER,
      quantity: 250,
      movementDate: subDays(now(), 7),
      reference: "TRF-LHE-09",
      notes: "Inter-warehouse transfer to Lahore",
      inventory: inv,
    },
    {
      id: "m4",
      inventoryId: "i3",
      movementType: MovementType.IN,
      quantity: 4500,
      movementDate: subDays(now(), 45),
      reference: "GRN-RAIL-22",
      notes: "Rail wagon receipt from Punjab procurement",
      inventory: mockInventoryList()[2],
    },
    {
      id: "m5",
      inventoryId: "i4",
      movementType: MovementType.IN,
      quantity: 3200,
      movementDate: subDays(now(), 8),
      reference: "GRN-IMP-31",
      notes: "Import cargo — Brazilian raw sugar",
      inventory: mockInventoryList()[3],
    },
    {
      id: "m6",
      inventoryId: "i5",
      movementType: MovementType.ADJUSTMENT,
      quantity: -15,
      movementDate: subDays(now(), 1),
      reference: "ADJ-MOIST-02",
      notes: "Moisture shrinkage adjustment post QC",
      inventory: mockInventoryList()[4],
    },
    {
      id: "m7",
      inventoryId: "i2",
      movementType: MovementType.IN,
      quantity: 2100,
      movementDate: subDays(now(), 12),
      reference: "GRN-ROAD-18",
      notes: "Road tanker inbound from Port Klang",
      inventory: mockInventoryList()[1],
    },
  ];
  if (!inventoryId) return all;
  return all.filter((m) => m.inventoryId === inventoryId);
}

export function mockInventoryAging() {
  const lots = mockInventoryList();
  return lots.map((lot) => {
    const arrival = lot.arrivalDate ?? subDays(now(), 30);
    const daysInStorage = Math.floor((now().getTime() - arrival.getTime()) / 86400000);
    const available = Number(lot.quantity) - Number(lot.reservedQty);
    return {
      id: lot.id,
      warehouseRef: lot.warehouseRef,
      commodity: lot.commodity.code,
      location: lot.location.name,
      quantity: Number(lot.quantity),
      available,
      reserved: Number(lot.reservedQty),
      daysInStorage,
      agingBucket: daysInStorage <= 30 ? "0-30d" : daysInStorage <= 60 ? "31-60d" : daysInStorage <= 90 ? "61-90d" : "90d+",
      expiryDate: lot.expiryDate,
      qualityGrade: lot.qualityGrade,
    };
  });
}

export function mockShipments(filter?: { status?: ShipmentStatus; locationId?: string }) {
  const rows = [
    {
      id: "sh1",
      reference: "SHP-2026-0041",
      blRef: "BL-KHI-88921",
      status: "IN_TRANSIT" as ShipmentStatus,
      quantity: 5200,
      shippedAt: subDays(now(), 5),
      eta: addDays(now(), 3),
      carrier: "Maersk Line",
      vesselName: "MV Pacific Grain",
      originName: "Port Klang, Malaysia",
      destName: "Karachi Port",
      tradeRef: "KAS-2026-10001",
      commodity: "WHT",
      counterparty: "Cargill Grain Asia",
      location: { id: "l4", name: "Karachi Port", type: LocationType.PORT },
    },
    {
      id: "sh2",
      reference: "SHP-2026-0042",
      blRef: "BL-PQ-77210",
      status: "LOADING" as ShipmentStatus,
      quantity: 1800,
      shippedAt: subDays(now(), 1),
      eta: addDays(now(), 12),
      carrier: "Hapag-Lloyd",
      vesselName: "MV Palm Star",
      originName: "Jebel Ali, UAE",
      destName: "Port Qasim",
      tradeRef: "KAS-2026-10002",
      commodity: "CPO",
      counterparty: "Al Ghurair Resources",
      location: { id: "l5", name: "Port Qasim", type: LocationType.PORT },
    },
    {
      id: "sh3",
      reference: "SHP-2026-0038",
      blRef: "BL-KHI-88102",
      status: "DELIVERED" as ShipmentStatus,
      quantity: 3200,
      shippedAt: subDays(now(), 18),
      eta: subDays(now(), 8),
      carrier: "MSC",
      vesselName: "MSC Brasilia",
      originName: "Santos, Brazil",
      destName: "Karachi Port",
      tradeRef: "KAS-2026-10005",
      commodity: "SUG",
      counterparty: "Universal Corporation",
      location: { id: "l4", name: "Karachi Port", type: LocationType.PORT },
    },
    {
      id: "sh4",
      reference: "SHP-2026-0043",
      blRef: "BL-LHE-55401",
      status: "DELAYED" as ShipmentStatus,
      quantity: 2400,
      shippedAt: subDays(now(), 14),
      eta: addDays(now(), 5),
      carrier: "Pakistan Railways Freight",
      vesselName: "Wagon rake PKR-4412",
      originName: "Multan Silo Cluster",
      destName: "Lahore Warehouse",
      tradeRef: "KAS-2026-10008",
      commodity: "WHT",
      counterparty: "Sindh Mills Corp",
      location: { id: "l2", name: "Lahore Warehouse", type: LocationType.WAREHOUSE },
    },
    {
      id: "sh5",
      reference: "SHP-2026-0044",
      blRef: "BL-KHI-89005",
      status: "PLANNED" as ShipmentStatus,
      quantity: 1500,
      shippedAt: addDays(now(), 7),
      eta: addDays(now(), 21),
      carrier: "CMA CGM",
      vesselName: "CMA CGM Marco Polo",
      originName: "New Orleans, USA",
      destName: "Karachi Port",
      tradeRef: "KAS-2026-10012",
      commodity: "SOY",
      counterparty: "Glencore Agri",
      location: { id: "l4", name: "Karachi Port", type: LocationType.PORT },
    },
    {
      id: "sh6",
      reference: "SHP-2026-0039",
      blRef: "BL-PQ-77188",
      status: "AT_PORT" as ShipmentStatus,
      quantity: 900,
      shippedAt: subDays(now(), 22),
      eta: subDays(now(), 2),
      carrier: "Evergreen",
      vesselName: "Ever Given (sister)",
      originName: "Ho Chi Minh, Vietnam",
      destName: "Port Qasim",
      tradeRef: "KAS-2026-10015",
      commodity: "RCE",
      counterparty: "Louis Dreyfus PK",
      location: { id: "l5", name: "Port Qasim", type: LocationType.PORT },
    },
    {
      id: "sh7",
      reference: "SHP-2026-0040",
      blRef: "BL-KHI-88890",
      status: "IN_TRANSIT" as ShipmentStatus,
      quantity: 1100,
      shippedAt: subDays(now(), 9),
      eta: addDays(now(), 6),
      carrier: "OOCL",
      vesselName: "OOCL Karachi",
      originName: "Mumbai, India",
      destName: "Karachi Port",
      tradeRef: "KAS-2026-10018",
      commodity: "CPO",
      counterparty: "FFC Agricultural",
      location: { id: "l4", name: "Karachi Port", type: LocationType.PORT },
    },
  ];
  return rows.filter(
    (r) =>
      (!filter?.status || r.status === filter.status) &&
      (!filter?.locationId || r.location.id === filter.locationId),
  );
}

export function mockShipmentSummary() {
  const all = mockShipments();
  const byStatus = (s: ShipmentStatus) => all.filter((x) => x.status === s);
  return {
    total: all.length,
    inTransit: byStatus("IN_TRANSIT").length + byStatus("AT_PORT").length + byStatus("LOADING").length,
    delayed: byStatus("DELAYED").length,
    delivered30d: byStatus("DELIVERED").length,
    totalQtyInPipeline: all
      .filter((x) => x.status !== "DELIVERED" && x.status !== "CANCELLED")
      .reduce((a, x) => a + x.quantity, 0),
  };
}

export function mockLocationsDetail() {
  const inv = mockInventoryList();
  const defs = [
    { id: "l1", name: "Karachi Warehouse", type: LocationType.WAREHOUSE, country: "PK", region: "Sindh", capacityMt: 25_000 },
    { id: "l2", name: "Lahore Warehouse", type: LocationType.WAREHOUSE, country: "PK", region: "Punjab", capacityMt: 18_000 },
    { id: "l3", name: "Multan Silo Cluster", type: LocationType.SILO, country: "PK", region: "Punjab", capacityMt: 12_000 },
    { id: "l4", name: "Karachi Port", type: LocationType.PORT, country: "PK", region: "Sindh", capacityMt: 40_000 },
    { id: "l5", name: "Port Qasim", type: LocationType.PORT, country: "PK", region: "Sindh", capacityMt: 35_000 },
  ];
  const seen = new Set(defs.map((loc) => loc.name.trim().toLowerCase()));
  const shared = getMergedLocations()
    .filter((loc) => !seen.has(loc.name.trim().toLowerCase()))
    .map((loc) => ({
      id: loc.id,
      name: loc.name,
      type: LocationType.WAREHOUSE,
      country: "PK",
      region: "Unassigned",
      capacityMt: 0,
    }));

  return [...defs, ...shared].map((loc) => {
    const lots = inv.filter((i) => i.locationId === loc.id);
    const onHand = lots.reduce((a, l) => a + Number(l.quantity), 0);
    const reserved = lots.reduce((a, l) => a + Number(l.reservedQty), 0);
    const inTransit = lots.reduce((a, l) => a + Number(l.inTransitQty), 0);
    const value = lots.reduce((a, l) => a + Number(l.totalValue), 0);
    const utilization = loc.capacityMt > 0 ? onHand / loc.capacityMt : 0;
    const commodities = [...new Set(lots.map((l) => l.commodity.code))];
    const activeShipments = mockShipments().filter((s) => s.location.id === loc.id && s.status !== "DELIVERED").length;
    return {
      ...loc,
      onHand,
      reserved,
      inTransit,
      value,
      utilization,
      lotCount: lots.length,
      commodities,
      activeShipments,
      availableCapacity: Math.max(0, loc.capacityMt - onHand),
    };
  });
}

export function mockCounterpartiesScm() {
  return [
    {
      id: "cp1",
      name: "Sindh Mills Corp",
      code: "SMC",
      type: "SELLER" as const,
      country: "PK",
      creditLimit: 3_500_000,
      activeTrades: 8,
      openShipments: 2,
      onTimeDeliveryPct: 0.94,
      avgLeadTimeDays: 14,
      commoditiesSupplied: ["WHT", "RCE"],
      lastDelivery: subDays(now(), 5),
    },
    {
      id: "cp2",
      name: "Al Ghurair Resources",
      code: "AGR",
      type: "SELLER" as const,
      country: "AE",
      creditLimit: 5_000_000,
      activeTrades: 5,
      openShipments: 1,
      onTimeDeliveryPct: 0.88,
      avgLeadTimeDays: 21,
      commoditiesSupplied: ["CPO"],
      lastDelivery: subDays(now(), 12),
    },
    {
      id: "cp3",
      name: "Cargill Grain Asia",
      code: "CGA",
      type: "SELLER" as const,
      country: "SG",
      creditLimit: 8_000_000,
      activeTrades: 6,
      openShipments: 1,
      onTimeDeliveryPct: 0.96,
      avgLeadTimeDays: 18,
      commoditiesSupplied: ["WHT", "SOY", "CRN"],
      lastDelivery: subDays(now(), 3),
    },
    {
      id: "cp4",
      name: "Glencore Agri",
      code: "GLN",
      type: "SELLER" as const,
      country: "CH",
      creditLimit: 12_000_000,
      activeTrades: 4,
      openShipments: 1,
      onTimeDeliveryPct: 0.91,
      avgLeadTimeDays: 25,
      commoditiesSupplied: ["SOY", "CRN", "WHT"],
      lastDelivery: subDays(now(), 20),
    },
    {
      id: "cp5",
      name: "Universal Corporation",
      code: "UNV",
      type: "SELLER" as const,
      country: "US",
      creditLimit: 4_500_000,
      activeTrades: 3,
      openShipments: 0,
      onTimeDeliveryPct: 0.97,
      avgLeadTimeDays: 28,
      commoditiesSupplied: ["SUG", "CTN"],
      lastDelivery: subDays(now(), 8),
    },
    {
      id: "cp6",
      name: "National Foods",
      code: "NAF",
      type: "BUYER" as const,
      country: "PK",
      creditLimit: 2_000_000,
      activeTrades: 7,
      openShipments: 0,
      onTimeDeliveryPct: 0.99,
      avgLeadTimeDays: 0,
      commoditiesSupplied: [] as string[],
      lastDelivery: subDays(now(), 2),
    },
    {
      id: "cp7",
      name: "Engro Grain Terminal",
      code: "EGT",
      type: "BUYER" as const,
      country: "PK",
      creditLimit: 6_000_000,
      activeTrades: 5,
      openShipments: 0,
      onTimeDeliveryPct: 0.95,
      avgLeadTimeDays: 0,
      commoditiesSupplied: [] as string[],
      lastDelivery: subDays(now(), 15),
    },
    {
      id: "cp8",
      name: "FFC Agricultural",
      code: "FFC",
      type: "SELLER" as const,
      country: "PK",
      creditLimit: 1_800_000,
      activeTrades: 4,
      openShipments: 1,
      onTimeDeliveryPct: 0.82,
      avgLeadTimeDays: 10,
      commoditiesSupplied: ["CPO", "SOY"],
      lastDelivery: subDays(now(), 18),
    },
  ];
}

export function mockSupplyChainOverview() {
  const inv = mockInventorySummary();
  const totalOnHand = inv.reduce((a, x) => a + x.onHand, 0);
  const totalReserved = inv.reduce((a, x) => a + x.reserved, 0);
  const totalTransit = inv.reduce((a, x) => a + x.transit, 0);
  const totalValue = inv.reduce((a, x) => a + x.value, 0);
  const ship = mockShipmentSummary();
  const locs = mockLocationsDetail();
  const avgUtilization = locs.reduce((a, l) => a + l.utilization, 0) / locs.length;

  return {
    kpis: {
      totalOnHand,
      totalReserved,
      totalTransit,
      totalValue,
      availableToSell: totalOnHand - totalReserved,
      fillRate: 0.967,
      avgDwellDays: 38,
      shipmentsInPipeline: ship.inTransit,
      delayedShipments: ship.delayed,
      avgLocationUtilization: avgUtilization,
      openPurchaseTrades: 12,
      awaitingReceipt: 4_200,
    },
    pipeline: [
      { stage: "Procurement", count: 12, qtyMt: 18_400, status: "active" },
      { stage: "Inbound / GRN", count: 4, qtyMt: 6_800, status: "active" },
      { stage: "In Storage", count: 8, qtyMt: totalOnHand, status: "active" },
      { stage: "Reserved / Allocated", count: 5, qtyMt: totalReserved, status: "active" },
      { stage: "Outbound / Loading", count: 2, qtyMt: 3_900, status: "active" },
      { stage: "In Transit", count: ship.inTransit, qtyMt: totalTransit + ship.totalQtyInPipeline, status: "active" },
      { stage: "Delivered (30d)", count: ship.delivered30d, qtyMt: 8_600, status: "complete" },
    ],
    alerts: [
      { id: "a1", severity: "high" as const, message: "Shipment SHP-2026-0043 delayed 6 days — rail congestion Multan→Lahore", ref: "SHP-2026-0043" },
      { id: "a2", severity: "medium" as const, message: "Karachi Port at 68% capacity — consider diversion to Port Qasim", ref: "l4" },
      { id: "a3", severity: "medium" as const, message: "CPO lot WH-LHE-204 approaching expiry in 125 days — prioritize offtake", ref: "i2" },
      { id: "a4", severity: "low" as const, message: "Position vs inventory variance: WHT −50 MT (pending recon)", ref: "POS-WHT" },
      { id: "a5", severity: "high" as const, message: "FFC Agricultural on-time delivery below 85% threshold", ref: "cp8" },
    ],
  };
}

export function mockPositionVsInventory() {
  return [
    { commodity: "WHT", code: "WHT", positionNet: 4200, physicalOnHand: 18_200, physicalAvailable: 17_500, variance: -50, variancePct: -0.001, status: "BREAK" as const },
    { commodity: "Palm Oil", code: "CPO", positionNet: -1900, physicalOnHand: 4200, physicalAvailable: 3800, variance: 0, variancePct: 0, status: "MATCHED" as const },
    { commodity: "Sugar", code: "SUG", positionNet: 0, physicalOnHand: 9600, physicalAvailable: 9600, variance: 0, variancePct: 0, status: "MATCHED" as const },
    { commodity: "Soybeans", code: "SOY", positionNet: 800, physicalOnHand: 3400, physicalAvailable: 3200, variance: 120, variancePct: 0.035, status: "PENDING_REVIEW" as const },
    { commodity: "Rice", code: "RCE", positionNet: 600, physicalOnHand: 2100, physicalAvailable: 1950, variance: 0, variancePct: 0, status: "MATCHED" as const },
  ];
}

export function mockKpis() {
  return {
    tradesYtd: 186,
    openTrades: 54,
    inventoryValue: 13_550_000,
    openMtmPnl: 128_450.75,
  };
}

export function mockTradeBlotter() {
  return [
    {
      id: "t1",
      tradeRef: "KAS-2026-10001",
      tradeDate: subDays(now(), 14),
      direction: TradeDirection.BUY,
      quantity: 5000,
      price: 275.0,
      currency: "USD",
      tradeStatus: TradeStatus.EXECUTED,
      commodity: { code: "WHT", name: "Wheat" },
      counterparty: { name: "Sindh Mills Corp", code: "SMC" },
    },
    {
      id: "t2",
      tradeRef: "KAS-2026-10002",
      tradeDate: subDays(now(), 8),
      direction: TradeDirection.SELL,
      quantity: 1200,
      price: 940.0,
      currency: "USD",
      tradeStatus: TradeStatus.CONFIRMED,
      commodity: { code: "CPO", name: "Palm Oil" },
      counterparty: { name: "Al Ghurair Resources", code: "AGR" },
    },
  ];
}

export function mockOpenBreaks() {
  return mockReconciliationList({ status: ReconStatus.BREAK });
}

export function mockCommodityList() {
  return getMergedCommodities();
}

export function mockTraceSearch(q?: string, commodityId?: string) {
  const batches = [
    {
      id: "demo-trace-1",
      batchRef: "KAS-BCH-2026-0100",
      commodityId: "c1",
      originFarm: "Sheikhupura Growers Coop",
      farmerName: "Coop Unit 4",
      farmLocation: "Punjab, Pakistan",
      harvestDate: subDays(now(), 90),
      quantity: 1200,
      certifications: ["GAP", "TraceVerified"],
      commodity: { code: "WHT", name: "Wheat" },
    },
    {
      id: "demo-trace-2",
      batchRef: "KAS-BCH-2026-0101",
      commodityId: "c1",
      originFarm: "Multan Organic Cluster",
      farmerName: null,
      farmLocation: "Punjab, Pakistan",
      harvestDate: subDays(now(), 60),
      quantity: 850,
      certifications: ["Organic"],
      commodity: { code: "WHT", name: "Wheat" },
    },
  ];
  let out = batches;
  if (commodityId) out = out.filter((b) => b.commodityId === commodityId);
  if (q?.trim()) {
    const low = q.toLowerCase();
    out = out.filter((b) => b.batchRef.toLowerCase().includes(low));
  }
  return out;
}

export function mockTraceById(id: string) {
  const all = mockTraceSearch();
  const hit = all.find((b) => b.id === id) ?? all[0];
  if (!hit) return null;
  return buildTraceDetail(hit.id);
}

function buildTraceDetail(id: string) {
  const base = mockTraceSearch().find((b) => b.id === id) ?? mockTraceSearch()[0];
  return {
    ...base,
    commodity: { name: "Wheat", code: "WHT" },
    chainOfCustody: [
      {
        id: "e1",
        batchId: id,
        eventType: TraceEventType.HARVEST,
        eventDate: subDays(now(), 92),
        location: base.farmLocation,
        actor: "Coop harvest team",
        notes: null as string | null,
        documents: [] as string[],
      },
      {
        id: "e2",
        batchId: id,
        eventType: TraceEventType.PROCESSING,
        eventDate: subDays(now(), 85),
        location: "Multan mill",
        actor: "Miller QA",
        notes: "Moisture within spec",
        documents: [] as string[],
      },
      {
        id: "e3",
        batchId: id,
        eventType: TraceEventType.STORAGE,
        eventDate: subDays(now(), 70),
        location: "Karachi Warehouse",
        actor: "WHA operator",
        notes: null as string | null,
        documents: [] as string[],
      },
      {
        id: "e4",
        batchId: id,
        eventType: TraceEventType.TRANSPORT,
        eventDate: subDays(now(), 40),
        location: "Karachi Port corridor",
        actor: "Forwarder",
        notes: null as string | null,
        documents: [] as string[],
      },
      {
        id: "e5",
        batchId: id,
        eventType: TraceEventType.SALE,
        eventDate: subDays(now(), 14),
        location: "FOB Karachi",
        actor: "Kastros Trading",
        notes: "Linked to export contract",
        documents: [] as string[],
      },
    ],
    tradeLinks: [
      {
        id: "tl1",
        tradeId: "t1",
        batchId: id,
        trade: { tradeRef: "KAS-2026-10001" },
      },
    ],
  };
}

export function mockTradesForCommodity() {
  return [
    {
      id: "t1",
      tradeRef: "KAS-2026-10001",
      tradeDate: subDays(now(), 14),
      commodityId: "c1",
      counterpartyId: "cp1",
      direction: TradeDirection.BUY,
      quantity: 5000,
      price: 275.0,
      currency: "USD",
      tradeStatus: TradeStatus.EXECUTED,
      counterparty: { name: "Sindh Mills Corp", code: "SMC" },
    },
  ];
}

// --- Trader desk (mock) ---

export type PaymentType = "DP" | "LC" | "CAD" | "ADVANCE_100" | "CREDIT_30";
export type { KycStatus } from "@/lib/trade-constants";
import type { KycStatus } from "@/lib/trade-constants";

import { PAYMENT_TYPE_LABELS } from "@/lib/trade-constants";

export type MockTraderTrade = {
  id: string;
  tradeRef: string;
  tradeDate: Date;
  traderName: string;
  desk: string;
  direction: TradeDirection;
  quantity: number;
  quantityUnit: string;
  price: number;
  currency: string;
  priceBasis: string;
  tradeStatus: TradeStatus;
  deliveryStart: Date;
  deliveryEnd: Date;
  originName: string;
  destName: string;
  incoterms: string;
  paymentType: PaymentType;
  paymentTerms: string;
  grade: string;
  productOrigin: string;
  qualityTolerances: string;
  maxMoisturePct: number;
  counterpartyKycStatus: KycStatus;
  counterpartyKycRef: string | null;
  contractRef: string | null;
  commodity: { id: string; code: string; name: string; unit: string };
  counterparty: {
    id: string;
    name: string;
    code: string;
    companyNameNtn?: string | null;
    ntn?: string | null;
    address?: string | null;
    bankDetails?: string | null;
  };
  marketPrice: number;
  mtmPnl: number;
  notes?: string;
  buyingCategory?: "Delivered" | "Spot" | null;
  executionProfile?: string | null;
  ratePerMaund?: number | null;
  ratePerKg?: number | null;
  commissionPerMaund?: number | null;
  lockedAt?: Date | null;
  lockedBy?: string | null;
  qualityTolerancesDetail?: {
    damagePct: number;
    brokenPct: number;
    fungusPct: number;
    foreignMatterPct: number;
    moisturePct: number;
  } | null;
};

type BookedTradesSnapshot = {
  mockTradeSeq: number;
  bookedTrades: MockTraderTrade[];
};

type BookedRuntime = {
  trades: MockTraderTrade[];
  mockTradeSeq: number;
};

const BOOKED_RUNTIME_KEY = "__kastrosBookedRuntime";

function getBookedRuntime(): BookedRuntime {
  const g = globalThis as typeof globalThis & {
    [BOOKED_RUNTIME_KEY]?: BookedRuntime;
  };
  if (!g[BOOKED_RUNTIME_KEY]) {
    g[BOOKED_RUNTIME_KEY] = { trades: [], mockTradeSeq: 10020 };
  }
  return g[BOOKED_RUNTIME_KEY];
}

/** Sync booked trades from disk so all Next.js server bundles see the same book. */
export function syncBookedTradesFromDisk(): void {
  if (!isLocalPersistEnabled()) return;
  const snap = readPersisted<BookedTradesSnapshot>(TRADES_FILE);
  if (!snap) return;
  const rt = getBookedRuntime();
  rt.trades.length = 0;
  rt.trades.push(...snap.bookedTrades);
  if (snap.mockTradeSeq > rt.mockTradeSeq) rt.mockTradeSeq = snap.mockTradeSeq;
}

function getBookedTrades(): MockTraderTrade[] {
  syncBookedTradesFromDisk();
  return getBookedRuntime().trades;
}

function persistBookedTrades() {
  const rt = getBookedRuntime();
  writePersisted(TRADES_FILE, {
    mockTradeSeq: rt.mockTradeSeq,
    bookedTrades: rt.trades,
  } satisfies BookedTradesSnapshot);
}

/** Keep booked / locked / updated trades on disk (survives logout and server restart). */
export function upsertBookedTrade(trade: MockTraderTrade) {
  const rt = getBookedRuntime();
  const idx = rt.trades.findIndex((t) => t.tradeRef === trade.tradeRef);
  if (idx >= 0) rt.trades[idx] = trade;
  else rt.trades.unshift(trade);
  persistBookedTrades();
}

function buildTraderTrade(
  partial: Partial<Omit<MockTraderTrade, "marketPrice" | "mtmPnl">> &
    Pick<
      MockTraderTrade,
      | "id"
      | "tradeRef"
      | "tradeDate"
      | "traderName"
      | "desk"
      | "direction"
      | "quantity"
      | "price"
      | "currency"
      | "tradeStatus"
      | "deliveryStart"
      | "deliveryEnd"
      | "originName"
      | "destName"
      | "paymentTerms"
      | "contractRef"
      | "commodity"
      | "counterparty"
    > & { marketPrice?: number },
): MockTraderTrade {
  const merged: Omit<MockTraderTrade, "marketPrice" | "mtmPnl"> = {
    quantityUnit: "MT",
    grade: "Grade A",
    productOrigin: partial.originName,
    qualityTolerances: "Max moisture 14%; foreign matter 2% max",
    maxMoisturePct: 14,
    incoterms: "FOB",
    paymentType: "LC",
    priceBasis: "Fixed",
    counterpartyKycStatus: "VERIFIED",
    counterpartyKycRef: "KYC-2025-001",
    notes: undefined,
    ...partial,
  };
  const marketPrice = partial.marketPrice ?? partial.price * (1 + (Math.random() - 0.45) * 0.02);
  const q = merged.quantity;
  const book = q * merged.price;
  const mkt = q * marketPrice;
  const mtmPnl =
    merged.direction === TradeDirection.BUY ? mkt - book : book - mkt;
  return { ...merged, marketPrice, mtmPnl };
}

// ---------- Corn Execution Seed Trades ----------
// These are pre-locked trades from the Corn Execution Excel. They appear
// on the execution desk without needing the trader to lock them manually.
const CORN_COMMODITY = { id: "c8", code: "CRN", name: "Corn", unit: "MT" };
const CORN_QUALITY = {
  damagePct: 1,
  brokenPct: 2,
  fungusPct: 0.5,
  foreignMatterPct: 1,
  moisturePct: 12,
};

function buildCornTrade(
  id: string,
  tradeRef: string,
  daysAgo: number,
  direction: TradeDirection,
  qty: number,
  ratePerMaund: number,
  counterpartyName: string,
  counterpartyCode: string,
  ntn: string,
  warehouse: string,
  buyingCategory: "Delivered" | "Spot" | null,
  status: TradeStatus,
): MockTraderTrade {
  const ratePerKg = ratePerMaund / 37.324; // 1 maund = 37.324 kg
  return buildTraderTrade({
    id,
    tradeRef,
    tradeDate: subDays(now(), daysAgo),
    traderName: "Ayesha Malik",
    desk: "AGRI_DESK",
    direction,
    quantity: qty,
    quantityUnit: "MT",
    price: ratePerKg * 1000,
    currency: "PKR",
    priceBasis: "Fixed",
    tradeStatus: status,
    deliveryStart: subDays(now(), daysAgo - 2),
    deliveryEnd: addDays(now(), 10),
    originName: direction === TradeDirection.BUY ? "Punjab Mandi" : warehouse,
    destName: direction === TradeDirection.BUY ? warehouse : "Ex-Warehouse",
    incoterms: direction === TradeDirection.BUY ? "Delivered" : "Ex-Warehouse",
    paymentType: "DP" as PaymentType,
    paymentTerms: "Delivery vs Payment",
    grade: "FAQ",
    productOrigin: "Punjab, Pakistan",
    qualityTolerances: "Moisture 12%; Damage 1%; Broken 2%; Fungus 0.5%",
    maxMoisturePct: 12,
    counterpartyKycStatus: "VERIFIED",
    counterpartyKycRef: `KYC-${counterpartyCode}-2025`,
    contractRef: tradeRef,
    commodity: CORN_COMMODITY,
    counterparty: { id: counterpartyCode, name: counterpartyName, code: counterpartyCode, ntn },
    buyingCategory: direction === TradeDirection.SELL ? null : buyingCategory,
    ratePerMaund,
    ratePerKg,
    commissionPerMaund: 0,
    qualityTolerancesDetail: CORN_QUALITY,
    lockedAt: status === TradeStatus.LOCKED ? subDays(now(), daysAgo - 1) : null,
    lockedBy: status === TradeStatus.LOCKED ? "Ayesha Malik" : null,
    executionProfile:
      status === TradeStatus.LOCKED
        ? direction === TradeDirection.SELL
          ? "SALE_EX_WAREHOUSE"
          : buyingCategory === "Spot"
            ? "PURCHASE_SPOT"
            : "PURCHASE_DELIVERED"
        : null,
    marketPrice: ratePerKg * 1000 * 1.005,
  });
}

export function baseCornTrades(): MockTraderTrade[] {
  return [
    // === SALE CONTRACTS (ex-warehouse) ===
    buildCornTrade("corn-sal-01", "KAS-COR26-SAL-0001", 68, TradeDirection.SELL, 100, 3130, "Ghullam Yaseen Enterprises", "GYE", "4486067-8", "K005-Shuja feed Wh", null, TradeStatus.LOCKED),
    buildCornTrade("corn-sal-02", "KAS-COR26-SAL-0002", 65, TradeDirection.SELL, 200, 3200, "Ghullam Yaseen Enterprises", "GYE", "4486067-8", "K005-Shuja feed Wh", null, TradeStatus.LOCKED),
    buildCornTrade("corn-sal-03", "KAS-COR26-SAL-0003", 63, TradeDirection.SELL, 200, 3250, "Ghullam Yaseen Enterprises", "GYE", "4486067-8", "K005-Shuja feed Wh", null, TradeStatus.LOCKED),
    buildCornTrade("corn-sal-04", "KAS-COR26-SAL-0004", 62, TradeDirection.SELL, 200, 3300, "Asaaf Commission Agent", "ACA", "5893705-1", "K005-Shuja feed Wh", null, TradeStatus.LOCKED),
    buildCornTrade("corn-sal-05", "KAS-COR26-SAL-0007", 55, TradeDirection.SELL, 300, 3340, "Ghullam Yaseen Enterprises", "GYE", "4486067-8", "K005-Shuja feed Wh", null, TradeStatus.LOCKED),
    buildCornTrade("corn-sal-06", "KAS-COR26-SAL-0008", 48, TradeDirection.SELL, 200, 3350, "Ishaq & Sons Commission Shop", "ISC", "3821447-4", "GodamTech - Silos", null, TradeStatus.LOCKED),
    buildCornTrade("corn-sal-07", "KAS-COR26-SAL-0010", 40, TradeDirection.SELL, 150, 3370, "Rashid Iqbal Commission Shop", "RIC", "6504630-6", "GodamTech - Silos", null, TradeStatus.LOCKED),
    buildCornTrade("corn-sal-08", "KAS-COR26-SAL-0012", 30, TradeDirection.SELL, 100, 3390, "M Ijaz Commission Shop", "MIC", "8190131-5", "K005-Shuja feed Wh", null, TradeStatus.LOCKED),
    buildCornTrade("corn-sal-09", "KAS-COR26-SAL-0015", 18, TradeDirection.SELL, 250, 3400, "Ghullam Yaseen Enterprises", "GYE", "4486067-8", "K005-Shuja feed Wh", null, TradeStatus.LOCKED),
    buildCornTrade("corn-sal-10", "KAS-COR26-SAL-0018", 10, TradeDirection.SELL, 180, 3420, "Asaaf Commission Agent", "ACA", "5893705-1", "GodamTech - Silos", null, TradeStatus.LOCKED),
    // === PURCHASE DELIVERED CONTRACTS ===
    buildCornTrade("corn-pur-01", "KAS-COR26-PUR-0001", 72, TradeDirection.BUY, 200, 3050, "Faiz Ahmed", "FAI", "4230420-2", "K005-Shuja feed Wh", "Delivered", TradeStatus.LOCKED),
    buildCornTrade("corn-pur-02", "KAS-COR26-PUR-0002", 65, TradeDirection.BUY, 150, 3080, "Al Noor Commission Shop", "ANC", "3767592-3", "GodamTech - Silos", "Delivered", TradeStatus.LOCKED),
    buildCornTrade("corn-pur-03", "KAS-COR26-PUR-0003", 55, TradeDirection.BUY, 300, 3100, "Ammar Industries", "AMI", "7579904-5", "K005-Shuja feed Wh", "Delivered", TradeStatus.LOCKED),
    buildCornTrade("corn-pur-04", "KAS-COR26-PUR-0004", 42, TradeDirection.BUY, 100, 3120, "Faiz Ahmed", "FAI", "4230420-2", "GodamTech - Silos", "Delivered", TradeStatus.LOCKED),
    buildCornTrade("corn-pur-05", "KAS-COR26-PUR-0005", 28, TradeDirection.BUY, 200, 3140, "Al Noor Commission Shop", "ANC", "3767592-3", "K005-Shuja feed Wh", "Delivered", TradeStatus.LOCKED),
    // === PURCHASE SPOT CONTRACTS ===
    buildCornTrade("corn-spot-01", "KAS-COR26-SPT-0001", 60, TradeDirection.BUY, 50, 3060, "Ishaq & Sons Commission Shop", "ISC", "3821447-4", "K005-Shuja feed Wh", "Spot", TradeStatus.LOCKED),
    buildCornTrade("corn-spot-02", "KAS-COR26-SPT-0002", 45, TradeDirection.BUY, 75, 3090, "M Ijaz Commission Shop", "MIC", "8190131-5", "GodamTech - Silos", "Spot", TradeStatus.LOCKED),
    buildCornTrade("corn-spot-03", "KAS-COR26-SPT-0003", 20, TradeDirection.BUY, 100, 3110, "Rashid Iqbal Commission Shop", "RIC", "6504630-6", "K005-Shuja feed Wh", "Spot", TradeStatus.LOCKED),
    // === PENDING (not yet locked) ===
    buildCornTrade("corn-pend-01", "KAS-COR26-PUR-0006", 3, TradeDirection.BUY, 120, 3160, "Ghullam Yaseen Enterprises", "GYE", "4486067-8", "K005-Shuja feed Wh", "Delivered", TradeStatus.PENDING),
    buildCornTrade("corn-pend-02", "KAS-COR26-SAL-0020", 1, TradeDirection.SELL, 200, 3430, "Asaaf Commission Agent", "ACA", "5893705-1", "K005-Shuja feed Wh", null, TradeStatus.PENDING),
  ];
}

function baseTraderTrades(traderName: string): MockTraderTrade[] {
  if (traderName !== "Ayesha Malik") return [];
  return [
    buildTraderTrade({
      id: "tt1",
      tradeRef: "KAS-2026-10001",
      tradeDate: subDays(now(), 14),
      traderName,
      desk: "AGRI_DESK",
      direction: TradeDirection.BUY,
      quantity: 5000,
      price: 275.0,
      currency: "USD",
      tradeStatus: TradeStatus.EXECUTED,
      deliveryStart: addDays(now(), 5),
      deliveryEnd: addDays(now(), 19),
      originName: "Port Klang, Malaysia",
      destName: "Karachi Port",
      paymentTerms: "LC at sight",
      paymentType: "LC" as PaymentType,
      grade: "Grade A",
      productOrigin: "Australia / Black Sea",
      qualityTolerances: "Protein min 12.5%; max moisture 14%; test weight 78 kg/hl min",
      maxMoisturePct: 14,
      incoterms: "CIF",
      counterpartyKycStatus: "VERIFIED",
      counterpartyKycRef: "KYC-CGA-2025",
      priceBasis: "Fixed",
      contractRef: "CTR-2026-2001",
      commodity: { id: "c1", code: "WHT", name: "Wheat", unit: "MT" },
      counterparty: { id: "cp3", name: "Cargill Grain Asia", code: "CGA" },
      marketPrice: 281.4,
    }),
    buildTraderTrade({
      id: "tt2",
      tradeRef: "KAS-2026-10002",
      tradeDate: subDays(now(), 8),
      traderName,
      desk: "VEGOIL_DESK",
      direction: TradeDirection.SELL,
      quantity: 1200,
      price: 940.0,
      currency: "USD",
      tradeStatus: TradeStatus.CONFIRMED,
      deliveryStart: addDays(now(), 2),
      deliveryEnd: addDays(now(), 16),
      originName: "Karachi Port",
      destName: "Jebel Ali, UAE",
      paymentTerms: "Net 30",
      paymentType: "CREDIT_30" as PaymentType,
      grade: "CP8",
      productOrigin: "Malaysia / Indonesia",
      qualityTolerances: "FFA max 5%; moisture & impurities max 0.1%",
      maxMoisturePct: 0.1,
      incoterms: "FOB",
      counterpartyKycStatus: "VERIFIED",
      counterpartyKycRef: "KYC-AGR-2024",
      priceBasis: "Fixed",
      contractRef: "CTR-2026-2002",
      commodity: { id: "c2", code: "CPO", name: "Palm Oil", unit: "MT" },
      counterparty: { id: "cp2", name: "Al Ghurair Resources", code: "AGR" },
      marketPrice: 935.2,
    }),
    buildTraderTrade({
      id: "tt3",
      tradeRef: "KAS-2026-10003",
      tradeDate: subDays(now(), 3),
      traderName,
      desk: "SOFTS_DESK",
      direction: TradeDirection.BUY,
      quantity: 2400,
      price: 460.0,
      currency: "USD",
      tradeStatus: TradeStatus.PENDING,
      deliveryStart: addDays(now(), 14),
      deliveryEnd: addDays(now(), 28),
      originName: "Santos, Brazil",
      destName: "Karachi Port",
      paymentTerms: "Net 15",
      contractRef: null,
      commodity: { id: "c3", code: "SUG", name: "Sugar", unit: "MT" },
      counterparty: { id: "cp5", name: "Universal Corporation", code: "UNV" },
      marketPrice: 468.75,
      notes: "Awaiting counterparty confirmation",
    }),
    buildTraderTrade({
      id: "tt4",
      tradeRef: "KAS-2026-10008",
      tradeDate: subDays(now(), 21),
      traderName,
      desk: "AGRI_DESK",
      direction: TradeDirection.BUY,
      quantity: 3200,
      price: 272.5,
      currency: "USD",
      tradeStatus: TradeStatus.EXECUTED,
      deliveryStart: subDays(now(), 2),
      deliveryEnd: addDays(now(), 12),
      originName: "Multan Silo Cluster",
      destName: "Lahore Warehouse",
      paymentTerms: "CAD",
      contractRef: "CTR-2026-2008",
      commodity: { id: "c1", code: "WHT", name: "Wheat", unit: "MT" },
      counterparty: { id: "cp1", name: "Sindh Mills Corp", code: "SMC" },
      marketPrice: 281.4,
    }),
    buildTraderTrade({
      id: "tt5",
      tradeRef: "KAS-2026-10012",
      tradeDate: subDays(now(), 1),
      traderName,
      desk: "AGRI_DESK",
      direction: TradeDirection.BUY,
      quantity: 1500,
      price: 438.0,
      currency: "USD",
      tradeStatus: TradeStatus.CONFIRMED,
      deliveryStart: addDays(now(), 21),
      deliveryEnd: addDays(now(), 35),
      originName: "New Orleans, USA",
      destName: "Karachi Port",
      paymentTerms: "Net 30",
      contractRef: "CTR-2026-2012",
      commodity: { id: "c6", code: "SOY", name: "Soybeans", unit: "MT" },
      counterparty: { id: "cp4", name: "Glencore Agri", code: "GLN" },
      marketPrice: 441.25,
    }),
    buildTraderTrade({
      id: "tt6",
      tradeRef: "KAS-2026-10015",
      tradeDate: now(),
      traderName,
      desk: "AGRI_DESK",
      direction: TradeDirection.SELL,
      quantity: 800,
      price: 285.0,
      currency: "USD",
      tradeStatus: TradeStatus.PENDING,
      deliveryStart: addDays(now(), 10),
      deliveryEnd: addDays(now(), 24),
      originName: "Karachi Warehouse",
      destName: "FOB Karachi",
      paymentTerms: "Net 15",
      contractRef: null,
      commodity: { id: "c1", code: "WHT", name: "Wheat", unit: "MT" },
      counterparty: { id: "cp6", name: "National Foods", code: "NAF" },
      marketPrice: 281.4,
      notes: "Draft — send for approval",
    }),
  ];
}

export function mockTraderTrades(traderName: string, filter?: { status?: TradeStatus }) {
  const canonical = canonicalTraderName(traderName);
  const booked = getBookedTrades();
  const bookedRefs = new Set(booked.map((t) => t.tradeRef));
  const all = [
    ...booked,
    ...baseTraderTrades(canonical).filter((t) => !bookedRefs.has(t.tradeRef)),
  ].filter((t) => traderNamesMatch(t.traderName, canonical));
  if (!filter?.status) return all.sort((a, b) => b.tradeDate.getTime() - a.tradeDate.getTime());
  return all.filter((t) => t.tradeStatus === filter.status).sort((a, b) => b.tradeDate.getTime() - a.tradeDate.getTime());
}

export function mockTraderTradeByRef(traderName: string, tradeRef: string) {
  const ref = tradeRef.trim();
  const canonical = canonicalTraderName(traderName);
  const trade =
    mockTraderTrades(traderName).find((t) => t.tradeRef === ref) ??
    mockTradeByRefGlobal(ref);
  if (!trade) return null;
  if (!traderNamesMatch(trade.traderName, canonical)) return null;
  return trade;
}

/** All trades in mock store (for execution desk). */
export function mockAllTraderTrades() {
  const booked = getBookedTrades();
  const bookedRefs = new Set(booked.map((t) => t.tradeRef));
  const out: MockTraderTrade[] = [...booked];
  for (const t of baseTraderTrades("Ayesha Malik")) {
    if (!bookedRefs.has(t.tradeRef)) out.push(t);
  }
  for (const t of baseCornTrades()) {
    if (!bookedRefs.has(t.tradeRef)) out.push(t);
  }
  return out.sort((a, b) => b.tradeDate.getTime() - a.tradeDate.getTime());
}

export function mockTradeByRefGlobal(tradeRef: string) {
  return mockAllTraderTrades().find((t) => t.tradeRef === tradeRef.trim()) ?? null;
}

export function mockTraderDeskSummary(traderName: string) {
  const trades = mockTraderTrades(canonicalTraderName(traderName));
  const isOpen = (s: TradeStatus) =>
    s === TradeStatus.PENDING ||
    s === TradeStatus.LOCKED ||
    s === TradeStatus.CONFIRMED ||
    s === TradeStatus.EXECUTED;
  const open = trades.filter((t) => isOpen(t.tradeStatus));
  const pending = trades.filter((t) => t.tradeStatus === TradeStatus.PENDING);
  const weekEnd = addDays(now(), 7);
  const deliveriesDue = trades.filter(
    (t) =>
      t.deliveryStart <= weekEnd &&
      (t.tradeStatus === TradeStatus.CONFIRMED || t.tradeStatus === TradeStatus.EXECUTED),
  );
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const bookedToday = trades.filter((t) => t.tradeDate >= todayStart);
  const myMtm = open.reduce((a, t) => a + t.mtmPnl, 0);

  return {
    traderName,
    desk: "AGRI_DESK",
    openTrades: open.length,
    pendingConfirmation: pending.length,
    deliveriesThisWeek: deliveriesDue.length,
    bookedToday: bookedToday.length,
    todayVolumeMt: bookedToday.reduce((a, t) => a + t.quantity, 0),
    myMtm,
    openNotional: open.reduce((a, t) => a + t.quantity * t.price, 0),
  };
}

export function mockTraderExposure(traderName: string) {
  const trades = mockTraderTrades(canonicalTraderName(traderName)).filter(
    (t) =>
      t.tradeStatus === TradeStatus.CONFIRMED ||
      t.tradeStatus === TradeStatus.EXECUTED ||
      t.tradeStatus === TradeStatus.LOCKED ||
      t.tradeStatus === TradeStatus.PENDING,
  );
  const byCommodity = new Map<
    string,
    { code: string; name: string; long: number; short: number; mtm: number; marketPrice: number }
  >();
  for (const t of trades) {
    const cur = byCommodity.get(t.commodity.code) ?? {
      code: t.commodity.code,
      name: t.commodity.name,
      long: 0,
      short: 0,
      mtm: 0,
      marketPrice: t.marketPrice,
    };
    if (t.direction === TradeDirection.BUY) cur.long += t.quantity;
    else cur.short += t.quantity;
    cur.mtm += t.mtmPnl;
    byCommodity.set(t.commodity.code, cur);
  }
  return Array.from(byCommodity.values()).map((c) => ({
    ...c,
    net: c.long - c.short,
  }));
}

export function mockTraderActionItems(traderName: string) {
  const trades = mockTraderTrades(canonicalTraderName(traderName));
  const items: { id: string; type: string; message: string; tradeRef: string; priority: "high" | "medium" | "low" }[] = [];
  for (const t of trades) {
    if (t.tradeStatus === TradeStatus.PENDING) {
      items.push({
        id: `act-${t.id}-pend`,
        type: "CONFIRMATION",
        message: `Send confirmation to ${t.counterparty.name}`,
        tradeRef: t.tradeRef,
        priority: "high",
      });
    }
    if (t.tradeStatus === TradeStatus.CONFIRMED && t.deliveryStart <= addDays(now(), 5)) {
      items.push({
        id: `act-${t.id}-del`,
        type: "DELIVERY",
        message: `Delivery window opens ${t.deliveryStart.toISOString().slice(0, 10)}`,
        tradeRef: t.tradeRef,
        priority: "medium",
      });
    }
  }
  return items;
}

export function mockCounterpartyOptions() {
  return getMergedCounterparties();
}

export function mockLocationOptions() {
  return getMergedLocations();
}

export function mockBookTrade(input: {
  traderName: string;
  commodityId: string;
  commodityCode: string;
  commodityName: string;
  counterpartyId: string;
  counterpartyName: string;
  counterpartyCode: string;
  direction: TradeDirection;
  quantity: number;
  quantityUnit: string;
  price: number;
  currency: string;
  priceBasis: string;
  deliveryStart: Date;
  deliveryEnd: Date;
  originName: string;
  destName: string;
  incoterms: string;
  paymentType: PaymentType;
  grade: string;
  productOrigin: string;
  qualityTolerances: string;
  maxMoisturePct: number;
  counterpartyKycStatus: KycStatus;
  counterpartyKycRef: string | null;
  counterpartyCompanyNameNtn?: string | null;
  counterpartyNtn?: string | null;
  counterpartyAddress?: string | null;
  counterpartyBankDetails?: string | null;
  notes?: string;
  buyingCategory?: "Delivered" | "Spot";
  ratePerMaund?: number;
  commissionPerMaund?: number;
}): MockTraderTrade {
  syncBookedTradesFromDisk();
  const rt = getBookedRuntime();
  rt.mockTradeSeq += 1;
  const tradeRef = `KAS-2026-${rt.mockTradeSeq}`;
  const trade = buildTraderTrade({
    id: `tt-new-${rt.mockTradeSeq}`,
    tradeRef,
    tradeDate: now(),
    traderName: canonicalTraderName(input.traderName),
    desk: "AGRI_DESK",
    direction: input.direction,
    quantity: input.quantity,
    quantityUnit: input.quantityUnit,
    price: input.price,
    currency: input.currency,
    priceBasis: input.priceBasis,
    tradeStatus: TradeStatus.PENDING,
    deliveryStart: input.deliveryStart,
    deliveryEnd: input.deliveryEnd,
    originName: input.originName,
    destName: input.destName,
    incoterms: input.incoterms,
    paymentType: input.paymentType,
    paymentTerms: PAYMENT_TYPE_LABELS[input.paymentType],
    grade: input.grade,
    productOrigin: input.productOrigin,
    qualityTolerances: input.qualityTolerances,
    maxMoisturePct: input.maxMoisturePct,
    counterpartyKycStatus: input.counterpartyKycStatus,
    counterpartyKycRef: input.counterpartyKycRef,
    contractRef: null,
    commodity: {
      id: input.commodityId,
      code: input.commodityCode,
      name: input.commodityName,
      unit: input.quantityUnit,
    },
    counterparty: {
      id: input.counterpartyId,
      name: input.counterpartyName,
      code: input.counterpartyCode,
      companyNameNtn: input.counterpartyCompanyNameNtn ?? null,
      ntn: input.counterpartyNtn ?? null,
      address: input.counterpartyAddress ?? null,
      bankDetails: input.counterpartyBankDetails ?? null,
    },
    notes: input.notes,
    buyingCategory: input.buyingCategory ?? (input.direction === TradeDirection.BUY ? "Delivered" : null),
    ratePerMaund: input.ratePerMaund ?? null,
    commissionPerMaund: input.commissionPerMaund ?? null,
    qualityTolerancesDetail: {
      damagePct: 0,
      brokenPct: 0.5,
      fungusPct: 0,
      foreignMatterPct: 0.5,
      moisturePct: input.maxMoisturePct,
    },
  });
  upsertBookedTrade(trade);
  return trade;
}
