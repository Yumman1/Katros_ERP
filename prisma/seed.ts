import {
  Prisma,
  PrismaClient,
  Role,
  TradeStatus,
  InventoryStatus,
  InvoiceStatus,
  InvoiceType,
  CashFlowType,
  ReconType,
  ReconStatus,
  TraceEventType,
  CommodityCategory,
  CounterpartyType,
  LocationType,
  TradeDirection,
  PriceType,
  MovementType,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import { subDays, startOfDay, addDays } from "date-fns";

const prisma = new PrismaClient();

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const d = (n: number | string) => new Prisma.Decimal(n);

async function main() {
  const rnd = mulberry32(20260512);

  await prisma.$transaction([
    prisma.traceChainEntry.deleteMany(),
    prisma.tradeTraceabilityLink.deleteMany(),
    prisma.traceabilityRecord.deleteMany(),
    prisma.reconciliation.deleteMany(),
    prisma.bankTransaction.deleteMany(),
    prisma.cashFlowEntry.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.inventoryMovement.deleteMany(),
    prisma.shipment.deleteMany(),
    prisma.mTMValue.deleteMany(),
    prisma.positionLeg.deleteMany(),
    prisma.position.deleteMany(),
    prisma.marketPrice.deleteMany(),
    prisma.trade.deleteMany(),
    prisma.inventory.deleteMany(),
    prisma.counterparty.deleteMany(),
    prisma.location.deleteMany(),
    prisma.commodity.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  const passwordHash = await bcrypt.hash("Kastros123!", 12);

  const admin = await prisma.user.create({
    data: {
      email: "admin@kastros.co",
      passwordHash,
      name: "Kastros Admin",
      role: Role.ADMIN,
    },
  });
  await prisma.user.createMany({
    data: [
      {
        email: "trader@kastros.co",
        passwordHash,
        name: "Ayesha Malik",
        role: Role.TRADER,
      },
      {
        email: "risk@kastros.co",
        passwordHash,
        name: "Omar Khan",
        role: Role.RISK_MANAGER,
      },
      {
        email: "finance@kastros.co",
        passwordHash,
        name: "Sana Rizvi",
        role: Role.FINANCE,
      },
      {
        email: "execution@kastros.co",
        passwordHash,
        name: "Asad Hussain",
        role: Role.EXECUTION,
      },
      {
        email: "view@kastros.co",
        passwordHash,
        name: "Read Only",
        role: Role.READ_ONLY,
      },
    ],
  });

  const uid = admin.id;

  const commodityDefs = [
    { name: "Wheat", code: "WHT", unit: "MT", exchange: "CBOT", ticker: "ZW", category: CommodityCategory.GRAINS, base: 278 },
    { name: "Palm Oil", code: "CPO", unit: "MT", exchange: "BMD", ticker: "FCPO", category: CommodityCategory.VEGOIL, base: 920 },
    { name: "Sugar", code: "SUG", unit: "MT", exchange: "ICE", ticker: "SB", category: CommodityCategory.SOFTS, base: 465 },
    { name: "Cotton", code: "CTN", unit: "MT", exchange: "ICE", ticker: "CT", category: CommodityCategory.SOFTS, base: 1820 },
    { name: "Coffee", code: "COF", unit: "MT", exchange: "ICE", ticker: "KC", category: CommodityCategory.SOFTS, base: 3050 },
    { name: "Soybeans", code: "SOY", unit: "MT", exchange: "CBOT", ticker: "ZS", category: CommodityCategory.OILSEEDS, base: 438 },
    { name: "Rice", code: "RCE", unit: "MT", exchange: "CBOT", ticker: "ZR", category: CommodityCategory.GRAINS, base: 512 },
    { name: "Corn", code: "CRN", unit: "MT", exchange: "CBOT", ticker: "ZC", category: CommodityCategory.GRAINS, base: 198 },
  ] as const;

  const commodities = await prisma.$transaction(
    commodityDefs.map((c) =>
      prisma.commodity.create({
        data: {
          name: c.name,
          code: c.code,
          unit: c.unit,
          exchange: c.exchange,
          tickerCode: c.ticker,
          category: c.category,
          createdById: uid,
        },
      }),
    ),
  );

  const locDefs = [
    { name: "Karachi Warehouse", type: LocationType.WAREHOUSE, country: "PK" },
    { name: "Lahore Warehouse", type: LocationType.WAREHOUSE, country: "PK" },
    { name: "Multan Silo Cluster", type: LocationType.SILO, country: "PK" },
    { name: "Karachi Port", type: LocationType.PORT, country: "PK" },
    { name: "Port Qasim", type: LocationType.PORT, country: "PK" },
  ];
  const locations = await prisma.$transaction(
    locDefs.map((l) =>
      prisma.location.create({
        data: { ...l, createdById: uid },
      }),
    ),
  );

  const cpNames = [
    ["AgriTrade Karachi", "ATK", CounterpartyType.BUYER, "PK"],
    ["Sindh Mills Corp", "SMC", CounterpartyType.SELLER, "PK"],
    ["Indus Softs", "IDS", CounterpartyType.BROKER, "PK"],
    ["Meezan Commodities", "MZC", CounterpartyType.BANK, "PK"],
    ["Glencore Agri", "GLN", CounterpartyType.SELLER, "CH"],
    ["Louis Dreyfus PK", "LDP", CounterpartyType.BUYER, "PK"],
    ["Cargill Grain Asia", "CGA", CounterpartyType.SELLER, "SG"],
    ["Engro Grain Terminal", "EGT", CounterpartyType.BUYER, "PK"],
    ["FFC Agricultural", "FFC", CounterpartyType.SELLER, "PK"],
    ["Vitol Bahrain Softs", "VBS", CounterpartyType.BROKER, "BH"],
    ["Al Ghurair Resources", "AGR", CounterpartyType.SELLER, "AE"],
    ["National Foods", "NAF", CounterpartyType.BUYER, "PK"],
    ["Habib Bank AG Zurich", "HBZ", CounterpartyType.BANK, "PK"],
    ["Shafi Gluco Chem", "SGC", CounterpartyType.BUYER, "PK"],
    ["Universal Corporation", "UNV", CounterpartyType.SELLER, "US"],
  ] as const;

  const counterparties = await prisma.$transaction(
    cpNames.map(([name, code, type, country]) =>
      prisma.counterparty.create({
        data: {
          name,
          code,
          type,
          country,
          creditLimit: d(2_500_000 + Math.floor(rnd() * 5_000_000)),
          createdById: uid,
        },
      }),
    ),
  );

  const today = startOfDay(new Date());
  const desks = ["AGRI_DESK", "SOFTS_DESK", "VEGOIL_DESK"];
  const traders = ["Ayesha Malik", "Bilal Farooq", "Hassan Rahim", "Nadia Javed"];

  const priceRows: Prisma.MarketPriceCreateManyInput[] = [];
  for (let day = 0; day < 90; day++) {
    const priceDate = subDays(today, day);
    for (let i = 0; i < commodities.length; i++) {
      const base = commodityDefs[i].base;
      const jitter = 1 + (rnd() - 0.5) * 0.04 - day * 0.0003;
      const close = Math.max(base * jitter, base * 0.85);
      priceRows.push({
        commodityId: commodities[i].id,
        priceDate,
        closePrice: d(close.toFixed(4)),
        currency: "USD",
        source: rnd() > 0.85 ? "Manual" : commodityDefs[i].exchange ?? "Exchange",
        createdById: uid,
      });
    }
  }
  await prisma.marketPrice.createMany({ data: priceRows });

  const statusPool: TradeStatus[] = [
    TradeStatus.CONFIRMED,
    TradeStatus.EXECUTED,
    TradeStatus.SETTLED,
    TradeStatus.PENDING,
    TradeStatus.CANCELLED,
  ];
  const weights = [0.28, 0.32, 0.22, 0.12, 0.06];

  const trades: Awaited<ReturnType<typeof prisma.trade.create>>[] = [];
  for (let n = 0; n < 120; n++) {
    const cIdx = Math.floor(rnd() * commodities.length);
    const commodity = commodities[cIdx];
    const base = commodityDefs[cIdx].base;
    let st: TradeStatus = TradeStatus.CONFIRMED;
    const r = rnd();
    let acc = 0;
    for (let i = 0; i < weights.length; i++) {
      acc += weights[i];
      if (r <= acc) {
        st = statusPool[i];
        break;
      }
    }
    const direction = rnd() > 0.52 ? TradeDirection.BUY : TradeDirection.SELL;
    const qty = Math.round(200 + rnd() * 4800);
    const priceJit = base * (1 + (rnd() - 0.48) * 0.06);
    const tradeDate = subDays(today, Math.floor(rnd() * 185));
    const del = addDays(tradeDate, 10 + Math.floor(rnd() * 50));

    const t = await prisma.trade.create({
      data: {
        tradeRef: `KAS-2026-${String(10001 + n).slice(1)}`,
        tradeDate,
        commodityId: commodity.id,
        counterpartyId: counterparties[Math.floor(rnd() * counterparties.length)].id,
        direction,
        quantity: d(qty),
        price: d(priceJit.toFixed(4)),
        currency: rnd() > 0.78 ? "PKR" : "USD",
        priceType: PriceType.FIXED,
        deliveryStart: del,
        deliveryEnd: addDays(del, 14),
        originLocationId: locations[Math.floor(rnd() * locations.length)].id,
        destLocationId: locations[Math.floor(rnd() * locations.length)].id,
        paymentTerms: ["Net 15", "Net 30", "CAD", "LC at sight", "10/90"][Math.floor(rnd() * 5)],
        tradeStatus: st,
        contractRef: rnd() > 0.4 ? `CTR-${2026}-${2000 + n}` : null,
        desk: desks[Math.floor(rnd() * desks.length)],
        traderName: traders[Math.floor(rnd() * traders.length)],
        createdById: uid,
      },
    });
    trades.push(t);
  }

  const openStatuses: TradeStatus[] = [
    TradeStatus.CONFIRMED,
    TradeStatus.EXECUTED,
    TradeStatus.PENDING,
  ];
  const openTrades = trades.filter((t) => openStatuses.includes(t.tradeStatus));

  const byCommodity = new Map<string, typeof openTrades>();
  for (const t of openTrades) {
    const arr = byCommodity.get(t.commodityId) ?? [];
    arr.push(t);
    byCommodity.set(t.commodityId, arr);
  }

  const positionDate = today;
  for (const commodity of commodities) {
    const list = byCommodity.get(commodity.id) ?? [];
    let long = new Prisma.Decimal(0);
    let short = new Prisma.Decimal(0);
    let buyNotional = new Prisma.Decimal(0);
    let sellNotional = new Prisma.Decimal(0);

    for (const t of list) {
      if (t.direction === TradeDirection.BUY) {
        long = long.add(t.quantity);
        buyNotional = buyNotional.add(t.quantity.mul(t.price));
      } else {
        short = short.add(t.quantity);
        sellNotional = sellNotional.add(t.quantity.mul(t.price));
      }
    }

    const net = long.sub(short);
    const avgBuy =
      long.gt(0) ? buyNotional.div(long) : null;
    const avgSell =
      short.gt(0) ? sellNotional.div(short) : null;

    const pos = await prisma.position.create({
      data: {
        commodityId: commodity.id,
        positionDate,
        longQty: long,
        shortQty: short,
        netQty: net,
        avgBuyPrice: avgBuy,
        avgSellPrice: avgSell,
        currency: "USD",
        createdById: uid,
      },
    });

    for (const t of list) {
      await prisma.positionLeg.create({
        data: {
          positionId: pos.id,
          tradeId: t.id,
          quantity: t.quantity,
          direction: t.direction,
          createdById: uid,
        },
      });
    }
  }

  const latestPrice = async (commodityId: string) => {
    const p = await prisma.marketPrice.findFirst({
      where: { commodityId },
      orderBy: { priceDate: "desc" },
    });
    return p ? Number(p.closePrice) : 0;
  };

  for (const t of openTrades) {
    const m = Number(t.price);
    const mq = await latestPrice(t.commodityId);
    const q = Number(t.quantity);
    const bookValue = q * m;
    const marketValue = q * mq;
    const mtmPnl =
      t.direction === TradeDirection.BUY
        ? marketValue - bookValue
        : bookValue - marketValue;

    await prisma.mTMValue.create({
      data: {
        tradeId: t.id,
        valuationDate: positionDate,
        marketPrice: d(mq),
        bookPrice: d(m),
        mtmPnl: d(mtmPnl.toFixed(4)),
        unrealizedPnl: d(mtmPnl.toFixed(4)),
        currency: t.currency,
        createdById: uid,
      },
    });
  }

  for (let i = 0; i < 24; i++) {
    const c = commodities[Math.floor(rnd() * commodities.length)];
    const loc = locations[Math.floor(rnd() * 3)];
    const qty = d(500 + rnd() * 4000);
    const vp = d(Number(commodityDefs.find((x) => x.code === c.code)?.base ?? 300) * (0.98 + rnd() * 0.05));
    const inv = await prisma.inventory.create({
      data: {
        commodityId: c.id,
        locationId: loc.id,
        quantity: qty,
        unit: "MT",
        valuationPrice: vp,
        totalValue: qty.mul(vp),
        qualityGrade: ["Grade A", "FAQ", "Milling"][Math.floor(rnd() * 3)],
        warehouseRef: `WH-${loc.name.slice(0, 3).toUpperCase()}-${100 + i}`,
        arrivalDate: subDays(today, Math.floor(rnd() * 60)),
        status:
          rnd() > 0.85 ? InventoryStatus.IN_STOCK : rnd() > 0.5 ? InventoryStatus.TRANSIT : InventoryStatus.RESERVED,
        reservedQty: d(Math.floor(rnd() * 200)),
        inTransitQty: d(Math.floor(rnd() * 150)),
        createdById: uid,
      },
    });

    await prisma.inventoryMovement.createMany({
      data: [
        {
          inventoryId: inv.id,
          movementType: MovementType.IN,
          quantity: qty,
          movementDate: subDays(today, 40),
          reference: "GRN-SEA",
          notes: "Inbound vessel discharge",
          createdById: uid,
        },
        ...(rnd() > 0.6
          ? [
              {
                inventoryId: inv.id,
                movementType: MovementType.OUT,
                quantity: d(Number(qty) * 0.12),
                movementDate: subDays(today, 5),
                reference: "OUT-LOCAL",
                notes: "Domestic offtake",
                createdById: uid,
              },
            ]
          : []),
      ],
    });
  }

  let invSeq = 5000;
  const invoiceTrades = trades
    .filter(
      (t) =>
        t.tradeStatus === TradeStatus.EXECUTED ||
        t.tradeStatus === TradeStatus.SETTLED ||
        t.tradeStatus === TradeStatus.CONFIRMED,
    )
    .slice(0, 58);

  for (const t of invoiceTrades) {
    const gross = Number(t.quantity) * Number(t.price);
    const invQty = t.direction === TradeDirection.BUY ? Number(t.quantity) * (rnd() > 0.9 ? 1.002 : 1) : Number(t.quantity);
    const amountJit = gross * (rnd() > 0.92 ? 1.015 : 1);
    const inv = await prisma.invoice.create({
      data: {
        invoiceRef: `INV-2026-${invSeq++}`,
        tradeId: t.id,
        counterpartyId: t.counterpartyId,
        invoiceDate: addDays(t.tradeDate, 3),
        dueDate: addDays(t.tradeDate, 33),
        amount: d(amountJit.toFixed(2)),
        quantity: d(invQty.toFixed(4)),
        currency: t.currency,
        status:
          rnd() > 0.75
            ? InvoiceStatus.PAID
            : rnd() > 0.55
              ? InvoiceStatus.SENT
              : rnd() > 0.3
                ? InvoiceStatus.PARTIALLY_PAID
                : InvoiceStatus.OVERDUE,
        invoiceType: t.direction === TradeDirection.BUY ? InvoiceType.PURCHASE : InvoiceType.SALES,
        createdById: uid,
      },
    });

    if (inv.status === InvoiceStatus.PAID || inv.status === InvoiceStatus.PARTIALLY_PAID) {
      const paidPart = inv.status === InvoiceStatus.PARTIALLY_PAID ? 0.55 : 1;
      await prisma.payment.create({
        data: {
          invoiceId: inv.id,
          paymentDate: addDays(inv.invoiceDate, 12),
          amount: d(Number(inv.amount) * paidPart),
          currency: inv.currency,
          method: ["SWIFT", "TT", "LC", "CASH"][Math.floor(rnd() * 4)],
          reference: `PAY-${invSeq}`,
          bankRef: `BK-${100000 + invSeq}`,
          createdById: uid,
        },
      });
    }
  }

  for (let i = 0; i < 70; i++) {
    const projected = rnd() > 0.45;
    const amt = (rnd() > 0.5 ? 1 : -1) * (50_000 + rnd() * 900_000);
    await prisma.cashFlowEntry.create({
      data: {
        entryDate: subDays(today, Math.floor(rnd() * 120)),
        valueDate: subDays(today, Math.floor(rnd() * 100)),
        entryType: [
          CashFlowType.TRADE_RECEIPT,
          CashFlowType.TRADE_PAYMENT,
          CashFlowType.FINANCING,
          CashFlowType.FX,
          CashFlowType.OVERHEAD,
        ][Math.floor(rnd() * 5)],
        amount: d(amt.toFixed(2)),
        currency: rnd() > 0.82 ? "PKR" : "USD",
        description: projected ? `Projected settlement ${i}` : `Actual bank movement ${i}`,
        tradeRef: rnd() > 0.5 ? trades[Math.floor(rnd() * trades.length)].tradeRef : null,
        isProjected: projected,
        isPaid: !projected,
        createdById: uid,
      },
    });
  }

  for (let i = 0; i < 35; i++) {
    const t = invoiceTrades[i % invoiceTrades.length];
    const inv = await prisma.invoice.findFirst({ where: { tradeId: t.id } });
    const gross = Number(t.quantity) * Number(t.price);
    const match = i % 4 !== 0;
    await prisma.reconciliation.create({
      data: {
        reconDate: subDays(today, Math.floor(rnd() * 30)),
        reconType: [
          ReconType.TRADE_VS_INVOICE,
          ReconType.INVOICE_VS_PAYMENT,
          ReconType.POSITION_VS_INVENTORY,
          ReconType.PAYMENT_VS_BANK,
        ][i % 4],
        referenceA: t.tradeRef,
        referenceB: inv?.invoiceRef ?? `NO-INV-${i}`,
        expectedAmount: d(gross.toFixed(2)),
        actualAmount: d((match ? gross : gross * 1.08).toFixed(2)),
        difference: d(((match ? 0 : gross * 0.08) + (i % 7 === 0 ? 5000 : 0)).toFixed(2)),
        status: match ? ReconStatus.MATCHED : i % 7 === 0 ? ReconStatus.PENDING_REVIEW : ReconStatus.BREAK,
        notes: match ? null : "Quantity or FX variance under review",
        createdById: uid,
      },
    });
  }

  for (let i = 0; i < 40; i++) {
    await prisma.bankTransaction.create({
      data: {
        valueDate: subDays(today, Math.floor(rnd() * 90)),
        amount: d((rnd() > 0.5 ? 1 : -1) * (100_000 + rnd() * 2_000_000).toFixed(2)),
        currency: "USD",
        description: `Bank sweep / agri settlement ${i}`,
        bankRef: `BNK-${900000 + i}`,
        createdById: uid,
      },
    });
  }

  const wheat = commodities.find((c) => c.code === "WHT")!;
  for (let b = 0; b < 12; b++) {
    const batch = await prisma.traceabilityRecord.create({
      data: {
        batchRef: `KAS-BCH-2026-${String(100 + b).padStart(4, "0")}`,
        commodityId: wheat.id,
        originFarm: `Farm Sheikhupura Block ${b + 1}`,
        farmerName: `Grower Coop ${b + 1}`,
        farmLocation: "Punjab, Pakistan",
        harvestDate: subDays(today, 120 - b * 8),
        quantity: d(400 + rnd() * 800),
        certifications: b % 3 === 0 ? ["Organic"] : b % 2 === 0 ? ["GAP"] : ["TraceVerified"],
        createdById: uid,
      },
    });
    const events: TraceEventType[] = [
      TraceEventType.HARVEST,
      TraceEventType.PROCESSING,
      TraceEventType.STORAGE,
      TraceEventType.TRANSPORT,
      TraceEventType.SALE,
    ];
    let dt = batch.harvestDate;
    for (let ei = 0; ei < events.length; ei++) {
      const ev = events[ei];
      dt = addDays(dt, 3);
      await prisma.traceChainEntry.create({
        data: {
          batchId: batch.id,
          eventType: ev,
          eventDate: dt,
          location: ei < 2 ? batch.farmLocation : "Karachi Port corridor",
          actor: ["Coop", "Miller", "WHA", "Forwarder", "Kastros Trading"][ei],
          notes: null,
          documents: [],
          createdById: uid,
        },
      });
    }
    const linkTrade = openTrades[b % openTrades.length];
    if (linkTrade) {
      await prisma.tradeTraceabilityLink.create({
        data: { tradeId: linkTrade.id, batchId: batch.id, createdById: uid },
      });
    }
  }

  console.log("Seed complete. Login: admin@kastros.co / Kastros123!");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
