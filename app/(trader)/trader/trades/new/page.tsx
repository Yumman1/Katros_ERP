"use client";

import { CreatableSelect } from "@/components/trader/creatable-select";
import { trpc } from "@/lib/trpc/client";
import {
  BUYING_CATEGORIES,
  INCOTERMS,
  isDestinationRequired,
  PAYMENT_TYPE_LABELS,
  PRICE_BASIS_OPTIONS,
  QUANTITY_UNITS,
} from "@/lib/trade-constants";
import { invalidateTradeFlowCaches } from "@/lib/invalidate-caches";
import { traderDisplayName } from "@/lib/trader-display-name";
import { zodResolver } from "@hookform/resolvers/zod";
import { CommodityCategory, CounterpartyType, TradeDirection } from "@prisma/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { addDays, format } from "date-fns";

const paymentTypes = ["DP", "LC", "CAD", "ADVANCE_100", "CREDIT_30"] as const;

const schema = z
  .object({
    traderName: z.string().min(1, "Trader name required"),
    commodityId: z.string().min(1, "Select commodity"),
    counterpartyId: z.string().min(1, "Select counterparty"),
    direction: z.nativeEnum(TradeDirection),
    quantity: z.number().positive("Quantity must be positive"),
    quantityUnit: z.string().trim().min(1, "Unit required"),
    price: z.number().positive("Price must be positive"),
    currency: z.enum(["USD", "PKR"]),
    priceBasis: z.enum(PRICE_BASIS_OPTIONS),
    deliveryStart: z.string().min(1),
    deliveryEnd: z.string().min(1),
    originName: z.string(),
    destName: z.string().optional(),
    incoterms: z.enum(INCOTERMS),
    paymentType: z.enum(paymentTypes),
    grade: z.string().min(1, "Grade required"),
    productOrigin: z.string().min(1, "Product origin required"),
    qualityTolerances: z.string().min(1, "Quality tolerances required"),
    maxMoisturePct: z.number().min(0).max(100),
    notes: z.string().optional(),
    buyingCategory: z.enum(BUYING_CATEGORIES).optional(),
  })
  .superRefine((data, ctx) => {
    if (!(data.originName ?? "").trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Shipment origin required", path: ["originName"] });
    }
    if (isDestinationRequired(data.incoterms) && !data.destName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Destination required for this Incoterm",
        path: ["destName"],
      });
    }
    if (new Date(data.deliveryEnd) < new Date(data.deliveryStart)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Delivery end must be after start",
        path: ["deliveryEnd"],
      });
    }
  });

type Form = z.infer<typeof schema>;

const defaultStart = format(addDays(new Date(), 14), "yyyy-MM-dd");
const defaultEnd = format(addDays(new Date(), 28), "yyyy-MM-dd");

export default function BookTradePage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: session, status: sessionStatus } = useSession();
  const refData = trpc.trader.referenceData.useQuery();
  const addCommodity = trpc.trader.addCommodity.useMutation({
    onSuccess: () => utils.trader.referenceData.invalidate(),
  });
  const addGrade = trpc.trader.addGrade.useMutation({
    onSuccess: () => utils.trader.referenceData.invalidate(),
  });
  const addLocation = trpc.trader.addLocation.useMutation({
    onSuccess: () => utils.trader.referenceData.invalidate(),
  });
  const addCounterparty = trpc.trader.addCounterparty.useMutation({
    onSuccess: () => utils.trader.referenceData.invalidate(),
  });
  const book = trpc.trader.bookTrade.useMutation({
    onSuccess: (res) => {
      if (res.trade) {
        utils.trader.tradeByRef.setData({ tradeRef: res.tradeRef }, res.trade);
      }
      invalidateTradeFlowCaches(utils, res.tradeRef);
      router.push(`/trader/trades/${encodeURIComponent(res.tradeRef)}`);
    },
  });

  const loggedInTraderName = traderDisplayName(session);
  const [showAddCommodity, setShowAddCommodity] = useState(false);
  const [showAddCp, setShowAddCp] = useState(false);
  const [newCommodity, setNewCommodity] = useState({ name: "", code: "", unit: "MT" });
  const [newCp, setNewCp] = useState<{
    name: string;
    code: string;
    type: CounterpartyType;
    country: string;
    companyNameNtn: string;
    ntn: string;
    address: string;
    bankDetails: string;
    kycRef: string;
    kycExpires: string;
  }>({
    name: "",
    code: "",
    type: CounterpartyType.SELLER,
    country: "PK",
    companyNameNtn: "",
    ntn: "",
    address: "",
    bankDetails: "",
    kycRef: "",
    kycExpires: "",
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      traderName: "",
      direction: TradeDirection.BUY,
      currency: "USD",
      deliveryStart: defaultStart,
      deliveryEnd: defaultEnd,
      paymentType: "LC",
      incoterms: "FOB",
      priceBasis: "Fixed",
      quantityUnit: "MT",
      quantity: 1000,
      price: 280,
      grade: "Grade A",
      productOrigin: "",
      qualityTolerances: "Max moisture 14%; foreign matter 2% max",
      maxMoisturePct: 14,
      originName: "",
      destName: "",
      commodityId: "",
      counterpartyId: "",
      buyingCategory: "Delivered",
    },
  });

  useEffect(() => {
    if (sessionStatus === "authenticated" && loggedInTraderName) {
      setValue("traderName", loggedInTraderName, { shouldValidate: true });
    }
  }, [sessionStatus, loggedInTraderName, setValue]);

  const qty = watch("quantity") ?? 0;
  const px = watch("price") ?? 0;
  const ccy = watch("currency") ?? "USD";
  const quantityUnit = watch("quantityUnit") ?? "MT";
  const formTraderName = watch("traderName");
  const commodityId = watch("commodityId");
  const counterpartyId = watch("counterpartyId");
  const incoterms = watch("incoterms");
  const direction = watch("direction");
  const destRequired = isDestinationRequired(incoterms ?? "FOB");

  const commodities = refData.data?.commodities ?? [];
  const quantityUnitOptions = refData.data?.quantityUnits ?? [...QUANTITY_UNITS];
  const selectedCommodity = commodities.find((c) => c.id === commodityId);
  const selectedCounterparty = refData.data?.counterparties.find((cp) => cp.id === counterpartyId);

  const gradeOptions = useMemo(() => {
    if (!selectedCommodity || !refData.data?.grades) return refData.data?.grades?.default ?? [];
    const g = refData.data.grades as Record<string, string[]>;
    return g[selectedCommodity.code] ?? g.default ?? [];
  }, [selectedCommodity, refData.data?.grades]);

  useEffect(() => {
    if (selectedCommodity?.unit) {
      // prefer server-provided units list (includes custom units)
      setValue("quantityUnit", selectedCommodity.unit);
    }
  }, [selectedCommodity?.id, selectedCommodity?.unit, setValue]);

  const locationOptions = useMemo(
    () => (refData.data?.locations ?? []).map((l) => ({ value: l.name, label: l.name })),
    [refData.data?.locations],
  );

  const [submitHint, setSubmitHint] = useState<string | null>(null);

  const onSubmit = handleSubmit(
    (data) => {
      setSubmitHint(null);
      if (selectedCounterparty && selectedCounterparty.kycStatus !== "VERIFIED") {
        setSubmitHint("Selected counterparty is not KYC verified.");
        return;
      }
      book.mutate({
        ...data,
        traderName: loggedInTraderName || data.traderName,
        deliveryStart: new Date(data.deliveryStart),
        deliveryEnd: new Date(data.deliveryEnd),
        originName: data.originName.trim(),
        destName: data.destName?.trim() || undefined,
        buyingCategory: data.direction === TradeDirection.BUY ? data.buyingCategory : undefined,
      });
    },
    () => {
      setSubmitHint("Please fix the highlighted fields before submitting.");
    },
  );

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <Link href="/trader" className="text-xs text-zinc-500 hover:text-kastros-green">
          ← Back to desk
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-white">Book a Trade</h1>
        <p className="text-sm text-zinc-500">
          Full contract capture — product specs, pricing, Incoterms, KYC, and payment terms.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-6 rounded-lg border border-kastros-border bg-kastros-card p-5">
        <Section title="Trader" description="Responsible trader for this deal">
          <Field label="Trader name" error={errors.traderName?.message}>
            <input type="hidden" {...register("traderName")} />
            <input
              readOnly
              value={
                sessionStatus === "loading"
                  ? "Loading…"
                  : formTraderName || loggedInTraderName || ""
              }
              className="w-full rounded-md border border-kastros-border bg-kastros-bg/60 px-3 py-2 text-sm text-zinc-300"
            />
            <p className="mt-1 text-xs text-zinc-600">Auto-filled from your login session</p>
          </Field>
        </Section>

        <Section title="Product specifications" description="Exact grade, origin, and quality tolerances">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Commodity" error={errors.commodityId?.message}>
              <select
                {...register("commodityId")}
                className="w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-white"
              >
                <option value="">Select…</option>
                {commodities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowAddCommodity((v) => !v)}
                className="mt-1 text-xs text-kastros-green hover:underline"
              >
                {showAddCommodity ? "Cancel" : "+ Add new commodity"}
              </button>
              {showAddCommodity && (
                <div className="mt-2 space-y-2 rounded-md border border-kastros-border/80 bg-kastros-bg/40 p-3">
                  <input
                    placeholder="Name"
                    value={newCommodity.name}
                    onChange={(e) => setNewCommodity((s) => ({ ...s, name: e.target.value }))}
                    className="w-full rounded-md border border-kastros-border bg-kastros-bg px-2 py-1.5 text-sm text-white"
                  />
                  <input
                    placeholder="Code (3–6 chars)"
                    value={newCommodity.code}
                    onChange={(e) => setNewCommodity((s) => ({ ...s, code: e.target.value.toUpperCase() }))}
                    className="w-full rounded-md border border-kastros-border bg-kastros-bg px-2 py-1.5 text-sm text-white"
                  />
                  <input
                    list="new-commodity-unit-options"
                    placeholder="Unit, e.g. MT, BAG, MAUND"
                    value={newCommodity.unit}
                    onChange={(e) => setNewCommodity((s) => ({ ...s, unit: e.target.value }))}
                    className="w-full rounded-md border border-kastros-border bg-kastros-bg px-2 py-1.5 text-sm text-white"
                  />
                  <datalist id="new-commodity-unit-options">
                    {quantityUnitOptions.map((u) => (
                      <option key={u} value={u} />
                    ))}
                  </datalist>
                  <p className="text-xs text-zinc-600">Pick an existing unit or type a new one.</p>
                  <button
                    type="button"
                    disabled={addCommodity.isPending || !newCommodity.unit.trim()}
                    onClick={async () => {
                      const row = await addCommodity.mutateAsync({
                        name: newCommodity.name,
                        code: newCommodity.code,
                        unit: newCommodity.unit.trim(),
                        category: CommodityCategory.OTHER,
                      });
                      setValue("commodityId", row.id);
                      setValue("quantityUnit", row.unit, { shouldValidate: true });
                      setShowAddCommodity(false);
                      setNewCommodity({ name: "", code: "", unit: "MT" });
                    }}
                    className="rounded-md bg-kastros-green px-3 py-1.5 text-xs font-semibold text-kastros-bg disabled:opacity-50"
                  >
                    Save commodity
                  </button>
                  {addCommodity.error && (
                    <p className="text-xs text-kastros-red">{addCommodity.error.message}</p>
                  )}
                </div>
              )}
            </Field>
            <Field label="Exact grade" error={errors.grade?.message}>
              <input type="hidden" {...register("grade")} />
              <CreatableSelect
                value={watch("grade") ?? ""}
                onChange={(v) => setValue("grade", v, { shouldValidate: true })}
                options={gradeOptions.map((g) => ({ value: g, label: g }))}
                onAdd={async (label) => {
                  if (!selectedCommodity) throw new Error("Select a commodity first");
                  const { grade } = await addGrade.mutateAsync({
                    commodityCode: selectedCommodity.code,
                    grade: label,
                  });
                  return { value: grade, label: grade };
                }}
                disabled={!selectedCommodity}
              />
            </Field>
            <Field label="Product origin (country / region)" error={errors.productOrigin?.message}>
              <input
                {...register("productOrigin")}
                placeholder="e.g. Punjab, Pakistan / Black Sea"
                className="w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-white"
              />
            </Field>
            <Field label="Max moisture content (%)" error={errors.maxMoisturePct?.message}>
              <input
                type="number"
                step="0.1"
                {...register("maxMoisturePct", { valueAsNumber: true })}
                className="w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-white data-grid"
              />
            </Field>
          </div>
          <Field label="Acceptable quality tolerances" error={errors.qualityTolerances?.message}>
            <textarea
              rows={3}
              {...register("qualityTolerances")}
              className="w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-white"
            />
          </Field>
        </Section>

        <Section title="Quantity" description="Contract volume and unit">
          <div className={`grid gap-4 ${direction === TradeDirection.BUY ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
            <Field label="Direction" error={errors.direction?.message}>
              <select
                {...register("direction")}
                className="w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-white"
              >
                <option value={TradeDirection.BUY}>BUY</option>
                <option value={TradeDirection.SELL}>SELL</option>
              </select>
            </Field>
            {direction === TradeDirection.BUY && (
              <Field label="Buying category" error={errors.buyingCategory?.message}>
                <select
                  {...register("buyingCategory")}
                  className="w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-white"
                >
                  {BUYING_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-zinc-600">
                  Spot → execution Purchase — Spot. Delivered → gatepass / inbound trucks.
                </p>
              </Field>
            )}
            <Field label={`Quantity (${quantityUnit})`} error={errors.quantity?.message}>
              <input
                type="number"
                step="0.01"
                {...register("quantity", { valueAsNumber: true })}
                className="w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-white data-grid"
              />
            </Field>
            <Field label="Unit" error={errors.quantityUnit?.message}>
              <select
                {...register("quantityUnit")}
                className="w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-white"
              >
                {quantityUnitOptions.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Section>

        <Section title="Pricing" description="Contract price and basis">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={`Price per ${quantityUnit}`} error={errors.price?.message}>
              <input
                type="number"
                step="0.01"
                {...register("price", { valueAsNumber: true })}
                className="w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-white data-grid"
              />
            </Field>
            <Field label="Currency" error={errors.currency?.message}>
              <select
                {...register("currency")}
                className="w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-white"
              >
                <option value="USD">USD</option>
                <option value="PKR">PKR</option>
              </select>
            </Field>
            <Field label="Price basis" error={errors.priceBasis?.message}>
              <select
                {...register("priceBasis")}
                className="w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-white"
              >
                {PRICE_BASIS_OPTIONS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="mt-2 text-xs text-zinc-500">
            Notional:{" "}
            <span className="data-grid text-kastros-green">
              {new Intl.NumberFormat("en-US", { style: "currency", currency: ccy }).format(qty * px)}
            </span>
          </div>
        </Section>

        <Section title="Delivery terms (Incoterms)" description="Shipment terms, window, and locations">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Incoterms" error={errors.incoterms?.message}>
              <select
                {...register("incoterms")}
                className="w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-white"
              >
                {(refData.data?.incoterms ?? [...INCOTERMS]).map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Delivery start" error={errors.deliveryStart?.message}>
              <input
                type="date"
                {...register("deliveryStart")}
                className="w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-white"
              />
            </Field>
            <Field label="Delivery end" error={errors.deliveryEnd?.message}>
              <input
                type="date"
                {...register("deliveryEnd")}
                className="w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-white"
              />
            </Field>
            <Field label="Shipment origin (load port / location)" error={errors.originName?.message}>
              <input type="hidden" {...register("originName")} />
              <CreatableSelect
                value={watch("originName") ?? ""}
                onChange={(v) => setValue("originName", v, { shouldValidate: true })}
                options={locationOptions}
                onAdd={async (name) => {
                  const row = await addLocation.mutateAsync({ name });
                  return { value: row.name, label: row.name };
                }}
              />
            </Field>
            <Field
              label={
                destRequired
                  ? "Destination (discharge / delivery point)"
                  : "Destination (optional for EXW / FCA / FOB)"
              }
              error={errors.destName?.message}
            >
              <input type="hidden" {...register("destName")} />
              <CreatableSelect
                value={watch("destName") ?? ""}
                onChange={(v) => setValue("destName", v, { shouldValidate: true })}
                options={locationOptions}
                onAdd={async (name) => {
                  const row = await addLocation.mutateAsync({ name });
                  return { value: row.name, label: row.name };
                }}
                placeholder={destRequired ? "Select…" : "Optional…"}
              />
            </Field>
          </div>
        </Section>

        <Section title="Counterparty verification (KYC)" description="Only KYC-verified counterparties can be booked">
          <Field label="Counterparty" error={errors.counterpartyId?.message}>
            <select
              {...register("counterpartyId")}
              className="w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-white"
            >
              <option value="">Select…</option>
              {refData.data?.counterparties.map((cp) => (
                <option key={cp.id} value={cp.id} disabled={cp.kycStatus !== "VERIFIED"}>
                  {cp.code} — {cp.name} {cp.kycStatus !== "VERIFIED" ? `[KYC ${cp.kycStatus}]` : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowAddCp((v) => !v)}
              className="mt-1 text-xs text-kastros-green hover:underline"
            >
              {showAddCp ? "Cancel" : "+ Add new counterparty"}
            </button>
          </Field>
          {showAddCp && (
            <div className="space-y-2 rounded-md border border-kastros-border/80 bg-kastros-bg/40 p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  placeholder="Trading / display name *"
                  value={newCp.name}
                  onChange={(e) => setNewCp((s) => ({ ...s, name: e.target.value }))}
                  className="rounded-md border border-kastros-border bg-kastros-bg px-2 py-1.5 text-sm text-white"
                />
                <input
                  placeholder="Short code *"
                  value={newCp.code}
                  onChange={(e) => setNewCp((s) => ({ ...s, code: e.target.value.toUpperCase() }))}
                  className="rounded-md border border-kastros-border bg-kastros-bg px-2 py-1.5 text-sm text-white"
                />
                <input
                  placeholder="Company name (as per NTN)"
                  value={newCp.companyNameNtn}
                  onChange={(e) => setNewCp((s) => ({ ...s, companyNameNtn: e.target.value }))}
                  className="rounded-md border border-kastros-border bg-kastros-bg px-2 py-1.5 text-sm text-white sm:col-span-2"
                />
                <input
                  placeholder="NTN no."
                  value={newCp.ntn}
                  onChange={(e) => setNewCp((s) => ({ ...s, ntn: e.target.value }))}
                  className="rounded-md border border-kastros-border bg-kastros-bg px-2 py-1.5 text-sm text-white"
                />
                <select
                  value={newCp.type}
                  onChange={(e) =>
                    setNewCp((s) => ({ ...s, type: e.target.value as CounterpartyType }))
                  }
                  className="rounded-md border border-kastros-border bg-kastros-bg px-2 py-1.5 text-sm text-white"
                >
                  <option value={CounterpartyType.BUYER}>BUYER</option>
                  <option value={CounterpartyType.SELLER}>SELLER</option>
                  <option value={CounterpartyType.BROKER}>BROKER</option>
                </select>
                <input
                  placeholder="Country *"
                  value={newCp.country}
                  onChange={(e) => setNewCp((s) => ({ ...s, country: e.target.value }))}
                  className="rounded-md border border-kastros-border bg-kastros-bg px-2 py-1.5 text-sm text-white"
                />
                <textarea
                  rows={2}
                  placeholder="Address"
                  value={newCp.address}
                  onChange={(e) => setNewCp((s) => ({ ...s, address: e.target.value }))}
                  className="rounded-md border border-kastros-border bg-kastros-bg px-2 py-1.5 text-sm text-white sm:col-span-2"
                />
                <textarea
                  rows={2}
                  placeholder="Bank details (account name, bank, IBAN / account no.)"
                  value={newCp.bankDetails}
                  onChange={(e) => setNewCp((s) => ({ ...s, bankDetails: e.target.value }))}
                  className="rounded-md border border-kastros-border bg-kastros-bg px-2 py-1.5 text-sm text-white sm:col-span-2"
                />
                <input
                  placeholder="KYC reference (optional)"
                  value={newCp.kycRef}
                  onChange={(e) => setNewCp((s) => ({ ...s, kycRef: e.target.value }))}
                  className="rounded-md border border-kastros-border bg-kastros-bg px-2 py-1.5 text-sm text-white"
                />
                <input
                  type="date"
                  title="KYC expiry"
                  value={newCp.kycExpires}
                  onChange={(e) => setNewCp((s) => ({ ...s, kycExpires: e.target.value }))}
                  className="rounded-md border border-kastros-border bg-kastros-bg px-2 py-1.5 text-sm text-white"
                />
              </div>
              <button
                type="button"
                disabled={addCounterparty.isPending}
                onClick={async () => {
                  const row = await addCounterparty.mutateAsync({
                    name: newCp.name,
                    code: newCp.code,
                    type: newCp.type,
                    country: newCp.country,
                    companyNameNtn: newCp.companyNameNtn || undefined,
                    ntn: newCp.ntn || undefined,
                    address: newCp.address || undefined,
                    bankDetails: newCp.bankDetails || undefined,
                    kycRef: newCp.kycRef || undefined,
                    kycExpires: newCp.kycExpires ? new Date(newCp.kycExpires) : undefined,
                  });
                  setValue("counterpartyId", row.id);
                  setShowAddCp(false);
                  setNewCp({
                    name: "",
                    code: "",
                    type: CounterpartyType.SELLER,
                    country: "PK",
                    companyNameNtn: "",
                    ntn: "",
                    address: "",
                    bankDetails: "",
                    kycRef: "",
                    kycExpires: "",
                  });
                }}
                className="rounded-md bg-kastros-green px-3 py-1.5 text-xs font-semibold text-kastros-bg disabled:opacity-50"
              >
                Save counterparty
              </button>
              {addCounterparty.error && (
                <p className="text-xs text-kastros-red">{addCounterparty.error.message}</p>
              )}
            </div>
          )}
          {selectedCounterparty && <KycPanel counterparty={selectedCounterparty} />}
        </Section>

        <Section title="Payment type" description="Settlement method for this trade">
          <div className="grid gap-2 sm:grid-cols-2">
            {paymentTypes.map((pt) => (
              <label
                key={pt}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-kastros-border px-3 py-2.5 text-sm hover:bg-white/[0.02]"
              >
                <input type="radio" value={pt} {...register("paymentType")} className="accent-kastros-green" />
                <span className="text-zinc-300">{PAYMENT_TYPE_LABELS[pt]}</span>
              </label>
            ))}
          </div>
          {errors.paymentType && (
            <p className="mt-1 text-xs text-kastros-red">{errors.paymentType.message}</p>
          )}
        </Section>

        <Field label="Internal notes (optional)" error={errors.notes?.message}>
          <textarea rows={2} {...register("notes")} className="w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-white" />
        </Field>

        {submitHint && <p className="text-sm text-amber-400">{submitHint}</p>}
        {Object.keys(errors).length > 0 && (
          <p className="text-sm text-kastros-red">
            {errors.commodityId?.message ||
              errors.counterpartyId?.message ||
              errors.originName?.message ||
              errors.destName?.message ||
              errors.productOrigin?.message ||
              errors.grade?.message ||
              "Check required fields above."}
          </p>
        )}
        {book.error && <p className="text-sm text-kastros-red">{book.error.message}</p>}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={
              isSubmitting ||
              book.isPending ||
              (selectedCounterparty != null && selectedCounterparty.kycStatus !== "VERIFIED")
            }
            className="rounded-md bg-kastros-green px-5 py-2 text-sm font-semibold text-kastros-bg hover:opacity-90 disabled:opacity-50"
          >
            {book.isPending ? "Booking…" : "Submit trade"}
          </button>
          <Link
            href="/trader/trades"
            className="rounded-md border border-kastros-border px-5 py-2 text-sm text-zinc-300 hover:bg-white/5"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-kastros-border/60 pb-5 last:border-0">
      <h2 className="text-sm font-medium text-zinc-300">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-zinc-600">{description}</p>}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-zinc-400">{label}</label>
      <div className="mt-1">{children}</div>
      {error && <p className="mt-1 text-xs text-kastros-red">{error}</p>}
    </div>
  );
}

function KycPanel({
  counterparty,
}: {
  counterparty: {
    name: string;
    code: string;
    kycStatus: string;
    kycRef: string | null;
    kycExpires: Date | null;
    companyNameNtn?: string | null;
    ntn?: string | null;
    address?: string | null;
    bankDetails?: string | null;
  };
}) {
  const statusStyle =
    counterparty.kycStatus === "VERIFIED"
      ? "border-kastros-green/30 bg-kastros-green/10 text-kastros-green"
      : counterparty.kycStatus === "PENDING"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
        : "border-red-500/30 bg-red-500/10 text-red-400";

  return (
    <div className={`rounded-md border px-3 py-2.5 text-xs ${statusStyle}`}>
      <div className="font-medium">
        KYC {counterparty.kycStatus} — {counterparty.name} ({counterparty.code})
      </div>
      {counterparty.kycRef && <div className="mt-1 opacity-80">Reference: {counterparty.kycRef}</div>}
      {counterparty.kycExpires && (
        <div className="mt-0.5 opacity-80">
          Expires:{" "}
          {counterparty.kycExpires instanceof Date
            ? counterparty.kycExpires.toISOString().slice(0, 10)
            : String(counterparty.kycExpires).slice(0, 10)}
        </div>
      )}
      {counterparty.companyNameNtn && (
        <div className="mt-1 opacity-80">Company (as per NTN): {counterparty.companyNameNtn}</div>
      )}
      {counterparty.ntn && <div className="mt-0.5 opacity-80">NTN no.: {counterparty.ntn}</div>}
      {counterparty.address && (
        <div className="mt-0.5 whitespace-pre-wrap opacity-80">Address: {counterparty.address}</div>
      )}
      {counterparty.bankDetails && (
        <div className="mt-0.5 whitespace-pre-wrap opacity-80">Bank: {counterparty.bankDetails}</div>
      )}
      {counterparty.kycStatus !== "VERIFIED" && (
        <div className="mt-1 font-medium">Cannot book until KYC is verified.</div>
      )}
    </div>
  );
}
