"use client";

import { ContractDetailsFields } from "@/components/trader/contract-details-fields";
import { CommodityRegistrationFields } from "@/components/trader/commodity-registration-fields";
import {
  CornSpecificationFields,
  defaultCornSpecifications,
} from "@/components/trader/corn-specification-fields";
import { WarehouseMultiSelect } from "@/components/trader/warehouse-multi-select";
import { formatQuantityTolerance, QuantityToleranceField } from "@/components/trader/quantity-tolerance-field";
import { TradeParametersFields } from "@/components/trader/trade-parameters-fields";
import { trpc } from "@/lib/trpc/client";
import {
  ALL_PRICE_BASIS_OPTIONS,
  CORN_COMMODITY_ORIGINS,
  CORN_DEAL_STATUS_OPTIONS,
  defaultIncotermForBooking,
  executionIncotermLabel,
  INCOTERMS,
  incotermsForBooking,
  isCornCommodity,
  formatQualityTolerancesSummary,
  type QualityTolerances,
  paymentTypeLabel,
  paymentTypesForBooking,
  priceBasisOptionsForCommodity,
  priceBasisRequiresQuote,
  QUANTITY_UNITS,
  TRADE_SCOPES,
  TRADE_SCOPE_LABELS,
} from "@/lib/trade-constants";
import {
  baseCurrencyOf,
  canonicalKgPerUnitOf,
  currencyToBaseFactor,
  defaultKgPerUnit,
  PRICE_CURRENCIES,
  PRICE_CURRENCY_LABELS,
  PRICE_WEIGHT_UNITS,
  quotedCurrencyLabel,
  priceUnitLabel,
  resolvePriceBasis,
  toPricePerCanonicalQty,
  type PriceCurrency,
} from "@/lib/price-units";
import {
  formatConversionPreview,
  mergeUnitRegistry,
  toMt,
  unitOptionLabel,
  type UnitDefinition,
} from "@/lib/unit-registry";
import {
  qualitySummaryFromParams,
  resolveAllTradeParameters,
  resolveCommoditySpecificParameters,
  type TradeParamDefinition,
  type TradeParamValues,
} from "@/lib/trade-parameters";
import { FormField as Field, FormSection as Section } from "@/components/ui/form-section";
import { NumericInput } from "@/components/ui/numeric-input";
import { invalidateTradeFlowCaches } from "@/lib/invalidate-caches";
import {
  serializeTraderWarehouseSelections,
  TRADER_WAREHOUSE_SELECTIONS_KEY,
} from "@/lib/warehouse-allocation";
import { warehouseStorageDivisionForCommodity } from "@/lib/warehouse-utilization";
import { traderDisplayName } from "@/lib/trader-display-name";
import { zodResolver } from "@hookform/resolvers/zod";
import { TradeDirection } from "@prisma/client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { addDays, differenceInCalendarDays, format } from "date-fns";
import {
  buildCommodityCreatePayload,
  commodityEntityRef,
  emptyCommodityFormState,
} from "@/lib/commodity-registration";

const bookingPaymentTypes = ["DP", "LC", "CAD", "ADVANCE_100", "CREDIT", "AFTER_DELIVERY_100"] as const;

const schema = z
  .object({
    traderName: z.string().min(1, "Trader name required"),
    tradeDate: z.string().min(1, "Trade date required"),
    commodityId: z.string().min(1, "Select commodity"),
    counterpartyId: z.string().min(1, "Select counterparty"),
    direction: z.nativeEnum(TradeDirection),
    quantity: z.number("Quantity is required").positive("Quantity must be positive"),
    quantityUnit: z.string().trim().min(1, "Unit required"),
    price: z.number().positive().optional(),
    priceCurrency: z.enum(PRICE_CURRENCIES),
    priceWeightUnit: z.string().trim().min(1, "Price unit required"),
    priceKgPerUnit: z.number().positive("kg per unit must be positive"),
    commissionPerUnit: z.number().min(0).optional(),
    priceBasis: z.enum(ALL_PRICE_BASIS_OPTIONS),
    deliveryStart: z.string().min(1),
    deliveryEnd: z.string().min(1),
    originName: z.string().optional(),
    incoterms: z.enum(INCOTERMS),
    paymentType: z.enum(bookingPaymentTypes),
    creditDays: z.number().int().positive().optional(),
    productOrigin: z.string().optional(),
    notes: z.string().optional(),
    tradeScope: z.enum(TRADE_SCOPES),
  })
  .superRefine((data, ctx) => {
    if (new Date(data.deliveryEnd) < new Date(data.deliveryStart)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Delivery end must be after start",
        path: ["deliveryEnd"],
      });
    }
    if (data.paymentType === "CREDIT" && !data.creditDays) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter credit days",
        path: ["creditDays"],
      });
    }
    if (priceBasisRequiresQuote(data.priceBasis)) {
      if (data.price == null || data.price <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Price is required for fixed trades",
          path: ["price"],
        });
      }
      if (data.commissionPerUnit == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Broker commission is required for fixed trades",
          path: ["commissionPerUnit"],
        });
      }
    }
  });

type Form = z.infer<typeof schema>;

const todayStr = format(new Date(), "yyyy-MM-dd");
const defaultStart = todayStr;
const defaultEnd = format(addDays(new Date(), 14), "yyyy-MM-dd");

export default function BookTradePage() {
  return (
    <Suspense fallback={null}>
      <BookTradeForm />
    </Suspense>
  );
}

function BookTradeForm() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const searchParams = useSearchParams();
  const draftParam = searchParams.get("draft");
  const { data: session, status: sessionStatus } = useSession();
  const refData = trpc.trader.referenceData.useQuery();
  const submitCommodityRequest = trpc.team.submitChangeRequest.useMutation({
    onSuccess: () => {
      void utils.team.myChangeRequests.invalidate();
    },
  });
  const addUnit = trpc.trader.addUnit.useMutation({
    onSuccess: () => utils.trader.referenceData.invalidate(),
  });
  const addCounterparty = trpc.trader.addCounterparty.useMutation({
    onSuccess: () => utils.trader.referenceData.invalidate(),
  });
  const updateFilerStatus = trpc.trader.setCounterpartyFilerStatus.useMutation({
    onSuccess: () => utils.trader.referenceData.invalidate(),
  });
  const book = trpc.trader.bookTrade.useMutation({
    onSuccess: (res) => {
      if (res.trade) {
        utils.trader.tradeByRef.setData({ tradeRef: res.tradeRef }, res.trade);
      }
      if (draftIdRef.current) {
        deleteDraft.mutate({ id: draftIdRef.current });
        draftIdRef.current = null;
      }
      invalidateTradeFlowCaches(utils, res.tradeRef);
      router.push(`/trader/trades/${encodeURIComponent(res.tradeRef)}`);
    },
  });
  const saveDraft = trpc.trader.saveBookingDraft.useMutation({
    onSuccess: (res) => {
      draftIdRef.current = res.id;
      setLastDraftSavedAt(new Date());
      void utils.trader.bookingDrafts.invalidate();
    },
  });
  const deleteDraft = trpc.trader.deleteBookingDraft.useMutation({
    onSuccess: () => void utils.trader.bookingDrafts.invalidate(),
  });
  const policy = trpc.policy.get.useQuery();

  const loggedInTraderName = traderDisplayName(session);
  const [showAddCommodity, setShowAddCommodity] = useState(false);
  const [commodityRequestComment, setCommodityRequestComment] = useState(
    "Request to register this commodity for trading.",
  );
  const [commodityRequestSuccess, setCommodityRequestSuccess] = useState<string | null>(null);
  const [showAddCp, setShowAddCp] = useState(false);
  const [selectedWarehouses, setSelectedWarehouses] = useState<string[]>([]);
  const [cornSpecs, setCornSpecs] = useState<QualityTolerances>(() => defaultCornSpecifications());
  const [newCommodityParams, setNewCommodityParams] = useState<TradeParamDefinition[]>([]);
  const [tradeParams, setTradeParams] = useState<TradeParamValues>({
    quantityToleranceMode: "percent",
  });
  const [sessionParamDefs, setSessionParamDefs] = useState<TradeParamDefinition[]>([]);
  const [showAddUnit, setShowAddUnit] = useState(false);
  const [newUnit, setNewUnit] = useState({ code: "", kgPerUnit: 1000 });
  const [newCommodity, setNewCommodity] = useState(emptyCommodityFormState);
  const [newCp, setNewCp] = useState<{
    name: string;
    ntn: string;
    contactPerson: string;
    contactPhone: string;
  }>({
    name: "",
    ntn: "",
    contactPerson: "",
    contactPhone: "",
  });

  // Autosaved booking draft — id is kept in a ref so debounced saves never go stale.
  const draftIdRef = useRef<string | null>(null);
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState<Date | null>(null);
  const lastSavedPayloadRef = useRef<string | null>(null);
  const draftRestoredRef = useRef(false);
  const restoreFixupRef = useRef<{
    form: Partial<Form>;
    cornSpecs: QualityTolerances | null;
  } | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    getValues,
    control,
    formState: { errors, isSubmitting },
  } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      traderName: "",
      tradeDate: todayStr,
      direction: TradeDirection.BUY,
      deliveryStart: defaultStart,
      deliveryEnd: defaultEnd,
      paymentType: "LC",
      creditDays: 30,
      incoterms: "Delivered",
      priceBasis: "Fixed",
      quantityUnit: "MT",
      priceCurrency: "PKR",
      priceWeightUnit: "MT",
      priceKgPerUnit: 1000,
      productOrigin: "",
      originName: "",
      commodityId: "",
      counterpartyId: "",
      tradeScope: "LOCAL",
    },
  });

  useEffect(() => {
    if (sessionStatus === "authenticated" && loggedInTraderName) {
      setValue("traderName", loggedInTraderName, { shouldValidate: true });
    }
  }, [sessionStatus, loggedInTraderName, setValue]);

  // Resume an autosaved draft (?draft=<id>) — restore form values, params,
  // warehouses, and corn specs, then keep saving to the same draft id.
  const draftQuery = trpc.trader.bookingDraft.useQuery(
    { id: draftParam ?? "" },
    { enabled: Boolean(draftParam), refetchOnWindowFocus: false },
  );

  useEffect(() => {
    if (draftRestoredRef.current) return;
    if (draftQuery.isError || (draftQuery.isSuccess && !draftQuery.data)) {
      // Draft gone (deleted or bad id) — continue as a fresh form/new draft.
      draftRestoredRef.current = true;
      return;
    }
    const draft = draftQuery.data;
    if (!draft) return;
    draftRestoredRef.current = true;
    const payload = (draft.payload ?? {}) as {
      form?: Partial<Form>;
      tradeParams?: TradeParamValues;
      selectedWarehouses?: string[];
      cornSpecs?: QualityTolerances;
    };
    const savedForm: Partial<Form> = { ...(payload.form ?? {}) };
    // JSON round-trips turn NaN (cleared number inputs) into null — drop those.
    for (const key of Object.keys(savedForm) as (keyof Form)[]) {
      if (savedForm[key] == null) delete savedForm[key];
    }
    reset({ ...getValues(), ...savedForm });
    if (payload.tradeParams) setTradeParams(payload.tradeParams);
    if (Array.isArray(payload.selectedWarehouses)) setSelectedWarehouses(payload.selectedWarehouses);
    if (payload.cornSpecs) setCornSpecs(payload.cornSpecs);
    // Commodity-driven effects overwrite units/specs once the commodity loads —
    // stash the saved values so the fixup effect below can re-apply them.
    restoreFixupRef.current = { form: savedForm, cornSpecs: payload.cornSpecs ?? null };
    draftIdRef.current = draft.id;
  }, [draftQuery.data, draftQuery.isError, draftQuery.isSuccess, reset, getValues]);

  // Fields start empty; react-hook-form yields NaN for cleared number inputs.
  const qtyRaw = watch("quantity");
  const qty = typeof qtyRaw === "number" && Number.isFinite(qtyRaw) ? qtyRaw : 0;
  const pxRaw = watch("price");
  const px = typeof pxRaw === "number" && Number.isFinite(pxRaw) ? pxRaw : 0;
  const quantityUnit = watch("quantityUnit") ?? "MT";
  const priceCurrency = watch("priceCurrency") ?? "PKR";
  const priceWeightUnit = watch("priceWeightUnit") ?? "MT";
  const priceKgPerUnit = watch("priceKgPerUnit") ?? 1000;
  const commissionPerUnit = watch("commissionPerUnit") as number | undefined;
  const tradeScope = watch("tradeScope") ?? "LOCAL";
  const baseCurrency = baseCurrencyOf(priceCurrency);
  const formTraderName = watch("traderName");
  const commodityId = watch("commodityId");
  const incoterms = watch("incoterms");
  const direction = watch("direction");
  const deliveryStart = watch("deliveryStart");
  const deliveryEnd = watch("deliveryEnd");
  const paymentType = watch("paymentType");
  const priceBasis = watch("priceBasis");
  const counterpartyId = watch("counterpartyId");

  const commodities = refData.data?.commodities ?? [];
  const quantityUnitOptions = refData.data?.quantityUnits ?? [...QUANTITY_UNITS];
  const priceWeightUnitOptions = refData.data?.priceWeightUnits ?? [...PRICE_WEIGHT_UNITS];
  const priceCurrencyOptions = refData.data?.priceCurrencies ?? [...PRICE_CURRENCIES];
  const selectedCommodity = commodities.find((c) => c.id === commodityId);

  // Single counterparty register (CP-xxxxx) — the same list serves both directions.
  const counterpartyOptions = refData.data?.counterparties ?? [];
  const selectedCounterparty = counterpartyOptions.find((cp) => cp.id === counterpartyId);

  // Filer / non-filer toggle — optimistic override until referenceData refetches.
  const [filerOverride, setFilerOverride] = useState<"FILER" | "NON_FILER" | null>(null);
  useEffect(() => {
    setFilerOverride(null);
  }, [counterpartyId]);
  const filerStatus = filerOverride ?? selectedCounterparty?.taxFilerStatus ?? "FILER";

  // Prefill contact person/number from the counterparty when the fields are empty.
  useEffect(() => {
    if (!selectedCounterparty) return;
    const { contactPerson, contactPhone } = selectedCounterparty;
    setTradeParams((p) => {
      const next = { ...p };
      let changed = false;
      if (!next.contactPerson && contactPerson) {
        next.contactPerson = contactPerson;
        changed = true;
      }
      if (!next.contactNumber && contactPhone) {
        next.contactNumber = contactPhone;
        changed = true;
      }
      return changed ? next : p;
    });
  }, [selectedCounterparty?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const sellInflow = trpc.policy.sellInflowStatus.useQuery(undefined, {
    enabled: direction === TradeDirection.SELL,
  });
  const isOverInflowLimit = (cpId: string) =>
    direction === TradeDirection.SELL &&
    sellInflow.data != null &&
    (sellInflow.data.byCounterparty[cpId] ?? 0) > sellInflow.data.limitPkr;
  const inflowLimitMillions =
    sellInflow.data != null
      ? Math.round(sellInflow.data.limitPkr / 1_000_000).toLocaleString("en-PK")
      : null;

  const bookingIncoterms = useMemo(
    () => incotermsForBooking(direction, tradeScope, selectedCommodity?.code),
    [direction, tradeScope, selectedCommodity?.code],
  );

  const isCorn = isCornCommodity(selectedCommodity?.code);
  const warehouseStorageDivision = useMemo(
    () =>
      selectedCommodity
        ? warehouseStorageDivisionForCommodity({
            commodityCode: selectedCommodity.code,
            quantityUnit: selectedCommodity.unit,
            category: selectedCommodity.category,
          })
        : null,
    [selectedCommodity],
  );
  const priceBasisOptions = useMemo(
    () => priceBasisOptionsForCommodity(selectedCommodity?.code),
    [selectedCommodity?.code],
  );
  const requiresQuotedPrice = priceBasisRequiresQuote(priceBasis);
  const visiblePaymentTypes = useMemo(
    () => paymentTypesForBooking(isCorn, tradeScope),
    [isCorn, tradeScope],
  );

  const deliveryWindowDays = useMemo(() => {
    if (!deliveryStart || !deliveryEnd) return null;
    const start = new Date(deliveryStart);
    const end = new Date(deliveryEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null;
    return differenceInCalendarDays(end, start) + 1;
  }, [deliveryStart, deliveryEnd]);

  useEffect(() => {
    const allowed = incotermsForBooking(direction, tradeScope, selectedCommodity?.code);
    if (!allowed.includes(incoterms)) {
      setValue(
        "incoterms",
        defaultIncotermForBooking(direction, tradeScope, selectedCommodity?.code),
        { shouldValidate: true },
      );
    }
  }, [direction, tradeScope, incoterms, selectedCommodity?.code, setValue]);

  useEffect(() => {
    if (!priceBasisOptions.includes(priceBasis)) {
      setValue("priceBasis", priceBasisOptions[0] as Form["priceBasis"], { shouldValidate: true });
    }
  }, [priceBasisOptions, priceBasis, setValue]);

  useEffect(() => {
    if (!(visiblePaymentTypes as readonly string[]).includes(paymentType)) {
      setValue("paymentType", (visiblePaymentTypes[0] ?? "LC") as Form["paymentType"], {
        shouldValidate: true,
      });
    }
  }, [visiblePaymentTypes, paymentType, setValue]);

  useEffect(() => {
    if (isCorn) {
      setCornSpecs(defaultCornSpecifications());
    }
  }, [selectedCommodity?.id, isCorn]);

  const unitRegistry = useMemo(() => {
    const custom = (refData.data?.units ?? []) as UnitDefinition[];
    return mergeUnitRegistry(custom);
  }, [refData.data?.units]);

  const commodityParamDefs = useMemo(() => {
    const base = resolveCommoditySpecificParameters(
      selectedCommodity?.code,
      selectedCommodity?.tradeParameterDefs ?? null,
    );
    const seen = new Set(base.map((d) => d.key));
    const extras = sessionParamDefs.filter((d) => !seen.has(d.key));
    return [...base, ...extras];
  }, [selectedCommodity?.code, selectedCommodity?.tradeParameterDefs, sessionParamDefs]);

  const allParamDefs = useMemo(
    () =>
      resolveAllTradeParameters(
        selectedCommodity?.code,
        selectedCommodity?.tradeParameterDefs ?? null,
        sessionParamDefs,
      ),
    [selectedCommodity?.code, selectedCommodity?.tradeParameterDefs, sessionParamDefs],
  );

  const qtyConversion = useMemo(
    () => (qty > 0 ? formatConversionPreview(qty, quantityUnit, unitRegistry) : null),
    [qty, quantityUnit, unitRegistry],
  );

  const storedMt = useMemo(
    () => (qty > 0 ? toMt(qty, quantityUnit, unitRegistry) : 0),
    [qty, quantityUnit, unitRegistry],
  );

  useEffect(() => {
    if (selectedCommodity?.unit) {
      // prefer server-provided units list (includes custom units)
      setValue("quantityUnit", selectedCommodity.unit);
    }
  }, [selectedCommodity?.id, selectedCommodity?.unit, setValue]);

  // When commodity or market scope changes, load that commodity's quoted price metric.
  useEffect(() => {
    const basis = resolvePriceBasis(selectedCommodity, tradeScope);
    setValue("priceCurrency", basis.currency, { shouldValidate: true });
    setValue("priceWeightUnit", basis.weightUnit, { shouldValidate: true });
    setValue("priceKgPerUnit", basis.kgPerUnit, { shouldValidate: true });
  }, [selectedCommodity?.id, tradeScope, setValue]); // eslint-disable-line react-hooks/exhaustive-deps

  // After a draft restore, the commodity effects above reset units, price
  // metric, and corn specs to commodity defaults — re-apply the saved values
  // once. Declared after those effects so it runs last in the same commit.
  useEffect(() => {
    const fix = restoreFixupRef.current;
    if (!fix || !selectedCommodity) return;
    restoreFixupRef.current = null;
    if (fix.cornSpecs) setCornSpecs(fix.cornSpecs);
    if (fix.form.quantityUnit) setValue("quantityUnit", fix.form.quantityUnit);
    if (fix.form.priceCurrency) setValue("priceCurrency", fix.form.priceCurrency);
    if (fix.form.priceWeightUnit) setValue("priceWeightUnit", fix.form.priceWeightUnit);
    if (typeof fix.form.priceKgPerUnit === "number") {
      setValue("priceKgPerUnit", fix.form.priceKgPerUnit);
    }
    if (fix.form.priceBasis) setValue("priceBasis", fix.form.priceBasis);
    if (fix.form.paymentType) setValue("paymentType", fix.form.paymentType);
    if (fix.form.incoterms) setValue("incoterms", fix.form.incoterms);
  }, [selectedCommodity?.id, setValue]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: warehouseAvailability, isLoading: warehouseAvailabilityLoading } =
    trpc.trader.warehouseAvailability.useQuery(
      { commodityId: commodityId || undefined },
      {
        enabled: Boolean(commodityId),
        refetchInterval: 60_000,
        refetchOnWindowFocus: true,
      },
    );

  const warehouseOptions = useMemo(() => {
    const availByName = new Map((warehouseAvailability ?? []).map((w) => [w.name, w]));
    return (refData.data?.companyWarehouses ?? []).map((w) => {
      const avail = availByName.get(w.name);
      return {
        ...w,
        availabilityPct: avail?.availabilityPct ?? null,
        grainDivisionSqFt: avail?.grainDivisionSqFt ?? null,
        balesDivisionSqFt: avail?.balesDivisionSqFt ?? null,
        availableGrainMt: avail?.availableGrainMt ?? null,
        availableBaleAsGrainMt: avail?.availableBaleAsGrainMt ?? null,
        storageDivision: avail?.storageDivision ?? warehouseStorageDivision,
        divisionAvailabilityPct: avail?.divisionAvailabilityPct ?? null,
        divisionAvailableMt: avail?.divisionAvailableMt ?? null,
        trueAvailableMt: avail?.trueAvailableMt ?? null,
        trueAvailabilityPct: avail?.trueAvailabilityPct ?? null,
      };
    });
  }, [refData.data?.companyWarehouses, warehouseAvailability, warehouseStorageDivision]);

  // Map the quoted price into the canonical quantity unit (MT) for notional / downstream preview.
  const canonicalKgPerUnit = canonicalKgPerUnitOf(
    selectedCommodity ?? { unit: "MT" },
  );
  const priceMetric = {
    currency: priceCurrency,
    weightUnit: priceWeightUnit,
    kgPerUnit: priceKgPerUnit || defaultKgPerUnit(priceWeightUnit),
  };
  // Canonical notional uses MT (stored quantity unit).
  const pricePerCanonical = toPricePerCanonicalQty(px, priceMetric, canonicalKgPerUnit);
  const notional = storedMt * pricePerCanonical;
  const qtyKg = storedMt * canonicalKgPerUnit;
  const priceDenomCount = priceKgPerUnit > 0 ? qtyKg / priceKgPerUnit : 0;
  const commissionTotalQuoted =
    commissionPerUnit != null && commissionPerUnit > 0 ? commissionPerUnit * priceDenomCount : 0;
  const commissionInBase = commissionTotalQuoted * currencyToBaseFactor(priceCurrency);
  const netAfterCommission = Math.max(0, notional - commissionInBase);
  /** Gross payable for finance — contract value plus broker commission. */
  const totalWithCommission = notional + commissionInBase;
  const quotedPriceUnit = priceUnitLabel({ currency: priceCurrency, weightUnit: priceWeightUnit });
  const fmtBase = (v: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: baseCurrency }).format(v);

  // 236G advance income tax on sell trades — filer vs non-filer rates are set
  // on Finance → Policies; the status itself is saved on the counterparty.
  const advanceTaxRatePct =
    filerStatus === "NON_FILER"
      ? policy.data?.advanceTaxRatePctNonFiler ?? null
      : policy.data?.advanceTaxRatePct ?? null;
  const advanceTaxAmount =
    direction === TradeDirection.SELL && notional > 0 && advanceTaxRatePct != null
      ? (notional * advanceTaxRatePct) / 100
      : 0;

  // ── Draft autosave — 2s after the last change, once the form is meaningful.
  const formValues = watch();
  const draftPayloadSerialized = JSON.stringify({
    form: formValues,
    tradeParams,
    selectedWarehouses,
    cornSpecs,
  });
  const bookPending = book.isPending;
  const bookSucceeded = book.isSuccess;
  useEffect(() => {
    if (bookPending || bookSucceeded) return;
    // When resuming, wait for the draft to load before autosaving over it.
    if (draftParam && !draftRestoredRef.current) return;
    const hasQty = typeof qtyRaw === "number" && Number.isFinite(qtyRaw) && qtyRaw > 0;
    const hasPrice = typeof pxRaw === "number" && Number.isFinite(pxRaw) && pxRaw > 0;
    if (!commodityId && !counterpartyId && !hasQty && !hasPrice) return;
    if (draftPayloadSerialized === lastSavedPayloadRef.current) return;
    const timer = setTimeout(() => {
      lastSavedPayloadRef.current = draftPayloadSerialized;
      saveDraft.mutate({
        id: draftIdRef.current,
        payload: JSON.parse(draftPayloadSerialized) as Record<string, unknown>,
        summary: {
          commodityLabel: selectedCommodity
            ? `${selectedCommodity.code} — ${selectedCommodity.name}`
            : null,
          counterpartyLabel: selectedCounterparty
            ? `${selectedCounterparty.code} — ${selectedCounterparty.name}`
            : null,
          direction: direction ?? null,
          quantityLabel: hasQty ? `${qty.toLocaleString()} ${quantityUnit}` : null,
        },
      });
    }, 2000);
    return () => clearTimeout(timer);
  }, [draftPayloadSerialized, bookPending, bookSucceeded, draftParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const [submitHint, setSubmitHint] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"draft" | "submit" | null>(null);

  const makeSubmit = (submitToExecution: boolean) =>
    handleSubmit(
      (data) => {
        setSubmitHint(null);
        setPendingAction(submitToExecution ? "submit" : "draft");
        const cleanedParams = Object.fromEntries(
          Object.entries(tradeParams).filter(([, v]) => v != null && v !== ""),
        ) as Record<string, string | number | null>;
        const toleranceLabel = formatQuantityTolerance(cleanedParams, data.quantityUnit);
        if (toleranceLabel) {
          cleanedParams.quantityTolerance = toleranceLabel;
        }
        delete cleanedParams.quantityToleranceMode;
        delete cleanedParams.quantityToleranceValue;
        if (isCorn && tradeScope === "LOCAL" && tradeParams.dealStatus) {
          cleanedParams.dealStatus = tradeParams.dealStatus;
        }
        if (tradeParams.contactPerson) {
          cleanedParams.contactPerson = tradeParams.contactPerson;
        }
        if (tradeParams.contactNumber) {
          cleanedParams.contactNumber = tradeParams.contactNumber;
        }
        if (data.paymentType === "CREDIT" && data.creditDays) {
          cleanedParams.creditDays = data.creditDays;
        }
        if (selectedWarehouses.length) {
          cleanedParams[TRADER_WAREHOUSE_SELECTIONS_KEY] = serializeTraderWarehouseSelections(
            selectedWarehouses,
          );
        }
        delete cleanedParams.warehouse;
        const mtQty = toMt(data.quantity, data.quantityUnit, unitRegistry);
        const isMaundPrice = /MAUND/i.test(data.priceWeightUnit);
        book.mutate({
          ...data,
          price: data.price && data.price > 0 ? data.price : undefined,
          traderName: loggedInTraderName || data.traderName,
          tradeDate: new Date(data.tradeDate),
          deliveryStart: new Date(data.deliveryStart),
          deliveryEnd: new Date(data.deliveryEnd),
          originName: isCorn ? "" : data.originName?.trim() || "",
          destName: "",
          productOrigin: data.productOrigin?.trim() || "",
          creditDays: data.paymentType === "CREDIT" ? data.creditDays : undefined,
          quantityEntered: data.quantity,
          quantityEnteredUnit: data.quantityUnit,
          quantity: mtQty,
          quantityUnit: "MT",
          commissionPerUnit: data.commissionPerUnit,
          commissionPerMaund: isMaundPrice && data.commissionPerUnit ? data.commissionPerUnit : undefined,
          tradeParams: cleanedParams,
          qualityTolerances: isCorn
            ? formatQualityTolerancesSummary(cornSpecs)
            : qualitySummaryFromParams(cleanedParams, allParamDefs),
          qualityTolerancesDetail: isCorn ? cornSpecs : undefined,
          maxMoisturePct: isCorn ? cornSpecs.moisturePct : undefined,
          submitToExecution,
        });
      },
      () => {
        setSubmitHint("Please fix the highlighted fields before submitting.");
      },
    );

  const onSubmit = makeSubmit(false);

  return (
    <div className="kastros-desk-page mx-auto w-full max-w-4xl">
      <div className="kastros-desk-scroll space-y-5 pb-6">
      <div>
        <Link href="/trader" className="text-xs text-subtle hover:text-success">
          ← Back to desk
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">Book a Trade</h1>
        <p className="text-sm text-subtle">
          {formTraderName || loggedInTraderName
            ? `Trader: ${formTraderName || loggedInTraderName} · `
            : ""}
          Capture contract, delivery, pricing, and commodity specs in one flow.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-5 rounded-lg border border-kastros-border bg-kastros-card p-5">
        {/* ── 1. Deal ── */}
        <Section title="Deal" description="Commodity, counterparty, and market">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Commodity" error={errors.commodityId?.message}>
              <select
                {...register("commodityId")}
                className="kastros-select w-full"
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
                onClick={() => {
                  setShowAddCommodity((v) => !v);
                  setCommodityRequestSuccess(null);
                }}
                className="mt-1 text-xs text-success hover:underline"
              >
                {showAddCommodity ? "Cancel" : "+ Request new commodity"}
              </button>
              {showAddCommodity && (
                <div className="mt-2 space-y-2 rounded-md border border-kastros-border/80 bg-kastros-bg/40 p-3">
                  <p className="text-xs text-subtle">
                    New commodities require CEO approval. Once approved, they appear in this dropdown for all traders.
                  </p>
                  <CommodityRegistrationFields
                    value={newCommodity}
                    onChange={setNewCommodity}
                    quantityUnitOptions={quantityUnitOptions}
                    tradeParameterDefs={newCommodityParams}
                    onTradeParameterDefsChange={setNewCommodityParams}
                    unitListId="new-commodity-unit-options"
                  />
                  <label className="text-xs text-subtle">Note for CEO</label>
                  <textarea
                    value={commodityRequestComment}
                    onChange={(e) => setCommodityRequestComment(e.target.value)}
                    rows={2}
                    className="w-full rounded-md border border-kastros-border bg-kastros-bg px-2 py-1.5 text-sm text-foreground"
                  />

                  <button
                    type="button"
                    disabled={
                      submitCommodityRequest.isPending ||
                      !newCommodity.name.trim() ||
                      !newCommodity.code.trim() ||
                      !newCommodity.unit.trim() ||
                      !commodityRequestComment.trim()
                    }
                    onClick={async () => {
                      setCommodityRequestSuccess(null);
                      const payload = buildCommodityCreatePayload(newCommodity, newCommodityParams);
                      await submitCommodityRequest.mutateAsync({
                        entityType: "COMMODITY",
                        entityRef: commodityEntityRef(payload.code),
                        entityLabel: `${payload.code} — ${payload.name}`,
                        action: "CREATE",
                        department: "TRADING",
                        comment: commodityRequestComment.trim(),
                        payload,
                      });
                      setCommodityRequestSuccess(
                        `${payload.code} submitted for CEO approval. You can book a trade once it is registered.`,
                      );
                      setShowAddCommodity(false);
                      setNewCommodity(emptyCommodityFormState());
                      setNewCommodityParams([]);
                    }}
                    className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-kastros-bg disabled:opacity-50"
                  >
                    Submit for CEO approval
                  </button>
                  {submitCommodityRequest.error && (
                    <p className="text-xs text-kastros-red">{submitCommodityRequest.error.message}</p>
                  )}
                </div>
              )}
              {commodityRequestSuccess && (
                <p className="mt-1 text-xs text-success">{commodityRequestSuccess}</p>
              )}
            </Field>

            <Field label="Counterparty" error={errors.counterpartyId?.message}>
              <select
                {...register("counterpartyId")}
                className="kastros-select w-full"
              >
                <option value="">Select…</option>
                {counterpartyOptions.map((cp) => (
                  <option key={cp.id} value={cp.id}>
                    {cp.code} — {cp.name}
                    {isOverInflowLimit(cp.id) && inflowLimitMillions
                      ? ` — ⚠ Caution: received over PKR ${inflowLimitMillions}M this FY`
                      : ""}
                  </option>
                ))}
              </select>
              {selectedCounterparty && sellInflow.data && isOverInflowLimit(selectedCounterparty.id) && (
                <p className="mt-1 text-xs text-warning">
                  Caution: payments received from {selectedCounterparty.name} this fiscal year (
                  {sellInflow.data.fiscalYear}) exceed the yearly inflow limit of PKR{" "}
                  {new Intl.NumberFormat("en-PK").format(sellInflow.data.limitPkr)}. Confirm with
                  finance before selling more.
                </p>
              )}
              <button
                type="button"
                onClick={() => setShowAddCp((v) => !v)}
                className="mt-1 text-xs text-success hover:underline"
              >
                {showAddCp ? "Cancel" : "+ Add counterparty"}
              </button>
              {showAddCp && (
                <div className="mt-2 space-y-2 rounded-md border border-kastros-border/80 bg-kastros-bg/40 p-3">
                  <input
                    placeholder="Trading display name *"
                    value={newCp.name}
                    onChange={(e) => setNewCp((s) => ({ ...s, name: e.target.value }))}
                    className="rounded-md border border-kastros-border bg-kastros-bg px-2 py-1.5 text-sm text-foreground"
                  />
                  <input
                    placeholder="NTN no."
                    value={newCp.ntn}
                    onChange={(e) => setNewCp((s) => ({ ...s, ntn: e.target.value }))}
                    className="rounded-md border border-kastros-border bg-kastros-bg px-2 py-1.5 text-sm text-foreground"
                  />
                  <input
                    placeholder="Contact person"
                    value={newCp.contactPerson}
                    onChange={(e) => setNewCp((s) => ({ ...s, contactPerson: e.target.value }))}
                    className="rounded-md border border-kastros-border bg-kastros-bg px-2 py-1.5 text-sm text-foreground"
                  />
                  <input
                    placeholder="Contact number"
                    value={newCp.contactPhone}
                    onChange={(e) => setNewCp((s) => ({ ...s, contactPhone: e.target.value }))}
                    className="rounded-md border border-kastros-border bg-kastros-bg px-2 py-1.5 text-sm text-foreground"
                  />
                  <p className="text-[11px] text-subtle">
                    A unique counterparty code (CP-xxxxx) is assigned automatically when you save.
                  </p>
                  <button
                    type="button"
                    disabled={addCounterparty.isPending || !newCp.name.trim()}
                    onClick={async () => {
                      const row = await addCounterparty.mutateAsync({
                        name: newCp.name.trim(),
                        country: "PK",
                        ntn: newCp.ntn.trim() || undefined,
                        contactPerson: newCp.contactPerson.trim() || undefined,
                        contactPhone: newCp.contactPhone.trim() || undefined,
                      });
                      setValue("counterpartyId", row.id);
                      setShowAddCp(false);
                      setNewCp({ name: "", ntn: "", contactPerson: "", contactPhone: "" });
                    }}
                    className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-kastros-bg disabled:opacity-50"
                  >
                    Save counterparty
                  </button>
                  {addCounterparty.error && (
                    <p className="text-xs text-kastros-red">{addCounterparty.error.message}</p>
                  )}
                </div>
              )}
            </Field>

            <Field label="Contact person (optional)">
              <input
                value={String(tradeParams.contactPerson ?? "")}
                onChange={(e) =>
                  setTradeParams((p) => ({ ...p, contactPerson: e.target.value || undefined }))
                }
                className="kastros-select w-full"
              />
            </Field>
            <Field label="Contact number (optional)">
              <input
                value={String(tradeParams.contactNumber ?? "")}
                onChange={(e) =>
                  setTradeParams((p) => ({ ...p, contactNumber: e.target.value || undefined }))
                }
                className="kastros-select w-full"
              />
            </Field>

            <Field label="Trade date" error={errors.tradeDate?.message}>
              <input type="date" {...register("tradeDate")} className="kastros-select w-full" />
            </Field>

            <Field label="Direction" error={errors.direction?.message}>
              <select
                {...register("direction")}
                className="kastros-select w-full"
              >
                <option value={TradeDirection.BUY}>BUY</option>
                <option value={TradeDirection.SELL}>SELL</option>
              </select>
            </Field>

            <Field label="Market" error={errors.tradeScope?.message}>
              <select
                {...register("tradeScope")}
                className="kastros-select w-full"
              >
                {TRADE_SCOPES.map((s) => (
                  <option key={s} value={s}>
                    {TRADE_SCOPE_LABELS[s]}
                  </option>
                ))}
              </select>
            </Field>

            {isCorn ? (
              <>
                <Field label="Commodity origin (optional)" error={errors.productOrigin?.message}>
                  <select
                    {...register("productOrigin")}
                    className="kastros-select w-full"
                  >
                    <option value="">—</option>
                    {CORN_COMMODITY_ORIGINS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </Field>
                {tradeScope === "LOCAL" && (
                  <Field label="Deal status">
                    <select
                      value={String(tradeParams.dealStatus ?? "")}
                      onChange={(e) =>
                        setTradeParams((p) => ({
                          ...p,
                          dealStatus: e.target.value || undefined,
                        }))
                      }
                      className="kastros-select w-full"
                    >
                      <option value="">—</option>
                      {CORN_DEAL_STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </>
            ) : (
              <Field label="Commodity origin" error={errors.productOrigin?.message}>
                <input
                  {...register("productOrigin")}
                  placeholder="e.g. Punjab, Pakistan"
                  className="kastros-select w-full"
                />
              </Field>
            )}
          </div>

          <input type="hidden" {...register("traderName")} />
        </Section>

        {/* ── 2. Quantity & pricing ── */}
        <Section
          title="Quantity & pricing"
          description={`Price and broker commission per selected unit (${quotedPriceUnit}). Quantity stored as MT internally (unit → kg → MT).`}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Quantity (${quantityUnit})`} error={errors.quantity?.message}>
              <Controller
                name="quantity"
                control={control}
                render={({ field }) => (
                  <NumericInput
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    className="w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-foreground data-grid"
                  />
                )}
              />
            </Field>
            <Field label="Unit" error={errors.quantityUnit?.message}>
              <select
                {...register("quantityUnit")}
                className="kastros-select w-full"
              >
                {quantityUnitOptions.map((u) => (
                  <option key={u} value={u}>
                    {unitOptionLabel(u, unitRegistry)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {qtyConversion && (
            <p className="mt-2 text-xs text-success data-grid">{qtyConversion.label}</p>
          )}
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowAddUnit((v) => !v)}
              className="text-xs text-success hover:underline"
            >
              {showAddUnit ? "Cancel" : "+ Register new unit with kg conversion"}
            </button>
            {showAddUnit && (
              <div className="mt-2 grid gap-2 rounded-md border border-kastros-border/60 bg-kastros-bg/40 p-3 sm:grid-cols-3">
                <input
                  placeholder="Unit code (e.g. BALE)"
                  value={newUnit.code}
                  onChange={(e) => setNewUnit((s) => ({ ...s, code: e.target.value.toUpperCase() }))}
                  className="rounded-md border border-kastros-border bg-kastros-bg px-2 py-1.5 text-sm text-foreground"
                />
                <input
                  type="number"
                  step="0.0001"
                  placeholder="kg per unit"
                  value={newUnit.kgPerUnit}
                  onChange={(e) => setNewUnit((s) => ({ ...s, kgPerUnit: Number(e.target.value) }))}
                  className="rounded-md border border-kastros-border bg-kastros-bg px-2 py-1.5 text-sm text-foreground data-grid"
                />
                <button
                  type="button"
                  disabled={addUnit.isPending || !newUnit.code.trim()}
                  onClick={async () => {
                    await addUnit.mutateAsync(newUnit);
                    setValue("quantityUnit", newUnit.code, { shouldValidate: true });
                    setShowAddUnit(false);
                    setNewUnit({ code: "", kgPerUnit: 1000 });
                  }}
                  className="rounded-md bg-success/20 px-3 py-1.5 text-xs font-medium text-success disabled:opacity-40"
                >
                  Save unit
                </button>
              </div>
            )}
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Quoted currency" error={errors.priceCurrency?.message}>
              <select
                {...register("priceCurrency")}
                className="kastros-select w-full"
              >
                {priceCurrencyOptions.map((c) => (
                  <option key={c} value={c}>
                    {PRICE_CURRENCY_LABELS[c as PriceCurrency] ?? c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Price per unit" error={errors.priceWeightUnit?.message}>
              {(() => {
                const wu = register("priceWeightUnit");
                return (
                  <input
                    list="price-weight-unit-options"
                    {...wu}
                    onChange={(e) => {
                      wu.onChange(e);
                      const factor = defaultKgPerUnit(e.target.value);
                      if (factor) setValue("priceKgPerUnit", factor, { shouldValidate: true });
                    }}
                    className="kastros-select w-full"
                  />
                );
              })()}
              <datalist id="price-weight-unit-options">
                {priceWeightUnitOptions.map((u) => (
                  <option key={u} value={u} label={unitOptionLabel(u, unitRegistry)} />
                ))}
              </datalist>
            </Field>
            <Field label="Price basis" error={errors.priceBasis?.message}>
              <select
                {...register("priceBasis")}
                className="kastros-select w-full"
              >
                {priceBasisOptions.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
              {!requiresQuotedPrice && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Unfixed trades can be submitted without a price — enter the price later from My Trades before
                  execution locks the contract.
                </p>
              )}
            </Field>
          </div>
          <input type="hidden" {...register("priceKgPerUnit", { valueAsNumber: true })} />
          <div className="mt-4">
            <QuantityToleranceField
              values={tradeParams}
              quantityUnit={quantityUnit}
              onChange={(key, value) => setTradeParams((p) => ({ ...p, [key]: value }))}
            />
          </div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field
              label={`Price (${quotedPriceUnit}) (without commission)${requiresQuotedPrice ? "" : " — optional"}`}
              error={errors.price?.message}
            >
              <Controller
                name="price"
                control={control}
                render={({ field }) => (
                  <NumericInput
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    placeholder={requiresQuotedPrice ? undefined : "Enter later from My Trades"}
                    className="w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-foreground data-grid"
                  />
                )}
              />
            </Field>
            <Field
              label={`Broker commission (${quotedPriceUnit})${requiresQuotedPrice ? "" : " — optional"}`}
              error={errors.commissionPerUnit?.message}
            >
              <Controller
                name="commissionPerUnit"
                control={control}
                render={({ field }) => (
                  <NumericInput
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    placeholder={`Optional — per ${priceWeightUnit || "unit"}`}
                    className="w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-foreground data-grid"
                  />
                )}
              />
            </Field>
          </div>
          {direction === TradeDirection.SELL && selectedCounterparty && (
            <div className="mt-3">
              <label className="text-xs font-medium text-muted-foreground">
                236G tax status — {selectedCounterparty.name}
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {(
                  [
                    {
                      value: "FILER",
                      label: `ATL filer (${policy.data?.advanceTaxRatePct ?? "—"}%)`,
                    },
                    {
                      value: "NON_FILER",
                      label: `Non-filer (${policy.data?.advanceTaxRatePctNonFiler ?? "—"}%)`,
                    },
                  ] as const
                ).map((opt) => (
                  <label
                    key={opt.value}
                    className="flex cursor-pointer items-center gap-2 rounded-full border border-kastros-border px-3 py-1.5 text-xs hover:bg-foreground/[0.02] has-[:checked]:border-success has-[:checked]:bg-success/5"
                  >
                    <input
                      type="radio"
                      name="counterpartyFilerStatus"
                      value={opt.value}
                      checked={filerStatus === opt.value}
                      onChange={() => {
                        setFilerOverride(opt.value);
                        updateFilerStatus.mutate({
                          counterpartyId: selectedCounterparty.id,
                          taxFilerStatus: opt.value,
                        });
                      }}
                      className="accent-brand"
                    />
                    <span className="text-muted-foreground">{opt.label}</span>
                  </label>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-subtle">
                Saved on the counterparty — the 236G rate below follows this status.
              </p>
              {updateFilerStatus.error && (
                <p className="mt-1 text-xs text-kastros-red">{updateFilerStatus.error.message}</p>
              )}
            </div>
          )}
          {requiresQuotedPrice && px > 0 && (
          <div className="mt-3 space-y-1 rounded-md border border-kastros-border/60 bg-kastros-bg/40 px-3 py-2 text-xs text-muted-foreground">
            <div>
              Mapped price:{" "}
              <span className="data-grid text-success">
                {fmtBase(pricePerCanonical)} / MT
              </span>
            </div>
            {qty > 0 && (
            <div>
              Notional ({storedMt.toLocaleString(undefined, { maximumFractionDigits: 4 })} MT):{" "}
              <span className="data-grid text-success">{fmtBase(notional)}</span>
            </div>
            )}
            {commissionPerUnit != null && commissionPerUnit > 0 && (
              <>
                <div>
                  Broker commission:{" "}
                  <span className="data-grid text-warning">
                    {commissionPerUnit.toLocaleString()} {quotedPriceUnit}
                    {priceDenomCount > 0 && (
                      <span className="text-subtle">
                        {" "}
                        × {priceDenomCount.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
                        {priceWeightUnit} = {commissionTotalQuoted.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
                        {quotedCurrencyLabel(priceCurrency)}
                      </span>
                    )}
                    {priceCurrency === "USd" && (
                      <span className="text-subtle"> ({fmtBase(commissionInBase)} settled)</span>
                    )}
                  </span>
                </div>
                <div>
                  Net after commission:{" "}
                  <span className="data-grid text-success">{fmtBase(netAfterCommission)}</span>
                </div>
                <div>
                  Total trade price (incl. commission):{" "}
                  <span className="data-grid font-semibold text-foreground">
                    {fmtBase(totalWithCommission)}
                  </span>
                </div>
              </>
            )}
            {direction === TradeDirection.SELL && notional > 0 && advanceTaxRatePct != null && (
              <>
                <div title="Set on Finance → Policies">
                  Advance income tax (236G, {advanceTaxRatePct}% —{" "}
                  {filerStatus === "NON_FILER" ? "non-filer" : "filer"}):{" "}
                  <span className="data-grid text-warning">{fmtBase(advanceTaxAmount)}</span>
                </div>
                <div title="Set on Finance → Policies">
                  Total receivable (incl. commission + 236G):{" "}
                  <span className="data-grid font-semibold text-foreground">
                    {fmtBase(notional + commissionInBase + advanceTaxAmount)}
                  </span>
                </div>
              </>
            )}
          </div>
          )}
        </Section>

        {/* ── 3. Delivery ── */}
        <Section title="Delivery" description="Incoterms, delivery window, port of load, and optional company warehouse">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Incoterms" error={errors.incoterms?.message}>
              <select
                {...register("incoterms")}
                className="kastros-select w-full"
              >
                {bookingIncoterms.map((i) => (
                  <option key={i} value={i}>
                    {executionIncotermLabel(i)}
                  </option>
                ))}
              </select>
              {tradeScope === "LOCAL" && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {isCorn
                    ? "Local corn: EXW — Ex Works or Delivered."
                    : "Local trades: Spot or Delivered only."}
                </p>
              )}
            </Field>
            <Field label="Delivery start" error={errors.deliveryStart?.message}>
              <input
                type="date"
                {...register("deliveryStart")}
                className="kastros-select w-full"
              />
            </Field>
            <Field label="Delivery end" error={errors.deliveryEnd?.message}>
              <input
                type="date"
                {...register("deliveryEnd")}
                className="kastros-select w-full"
              />
              {deliveryWindowDays != null && (
                <p className="mt-1 text-xs font-medium text-foreground">
                  Delivery window: {deliveryWindowDays} day{deliveryWindowDays === 1 ? "" : "s"}
                </p>
              )}
            </Field>
            {!isCorn && (
              <Field label="Origin / load point (optional)" error={errors.originName?.message}>
                <input
                  {...register("originName")}
                  placeholder="e.g. Port Qasim — external port or load point"
                  className="kastros-select w-full"
                />
              </Field>
            )}
            <Field label="Warehouses (optional)">
              <WarehouseMultiSelect
                warehouses={warehouseOptions}
                value={selectedWarehouses}
                onChange={setSelectedWarehouses}
                loading={warehouseAvailabilityLoading || !commodityId}
                storageDivision={warehouseStorageDivision}
              />
              <p className="mt-1 text-xs text-subtle">
                {warehouseStorageDivision === "grain"
                  ? "Grain capacity only — uses each warehouse's grain division (sq ft / MT). Shows availability % and free grain MT."
                  : warehouseStorageDivision === "bale"
                    ? "Bale capacity — uses each warehouse's bale division."
                    : "Select a commodity to see warehouse availability for its storage division."}
              </p>
            </Field>
          </div>
        </Section>

        {/* ── 4. Contract details / Payment ── */}
        {!isCorn && (
          <Section title="Contract details" description="Broker, tolerance, and payment — same fields on every trade in the file">
            <ContractDetailsFields
              values={tradeParams}
              onChange={(key, value) => setTradeParams((p) => ({ ...p, [key]: value }))}
            />
          </Section>
        )}

        <Section title="Payment" description="Settlement terms for this trade">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Payment type</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {visiblePaymentTypes.map((pt) =>
                pt === "CREDIT" ? (
                  <label
                    key={pt}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-kastros-border px-3 py-2 text-xs hover:bg-foreground/[0.02] has-[:checked]:border-success has-[:checked]:bg-success/5"
                  >
                    <input type="radio" value={pt} {...register("paymentType")} className="accent-brand" />
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <input
                        type="number"
                        min={1}
                        step={1}
                        {...register("creditDays", { valueAsNumber: true })}
                        onFocus={() => setValue("paymentType", "CREDIT", { shouldValidate: true })}
                        onClick={(e) => e.stopPropagation()}
                        className="w-11 rounded border border-kastros-border/80 bg-kastros-bg px-1 py-0.5 text-center text-xs text-foreground data-grid focus:border-success/50 focus:outline-none"
                      />
                      <span>Day Credit</span>
                    </span>
                  </label>
                ) : (
                  <label
                    key={pt}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-kastros-border px-3 py-2 text-xs hover:bg-foreground/[0.02] has-[:checked]:border-success has-[:checked]:bg-success/5"
                  >
                    <input type="radio" value={pt} {...register("paymentType")} className="accent-brand" />
                    <span className="text-muted-foreground">{paymentTypeLabel(pt)}</span>
                  </label>
                ),
              )}
            </div>
            {errors.creditDays && paymentType === "CREDIT" && (
              <p className="mt-1 text-xs text-kastros-red">{errors.creditDays.message}</p>
            )}
            {errors.paymentType && (
              <p className="mt-1 text-xs text-kastros-red">{errors.paymentType.message}</p>
            )}
          </div>
        </Section>

        {/* ── 5. Commodity-specific specs (only when template exists) ── */}
        {selectedCommodity && !isCorn && commodityParamDefs.length > 0 && (
          <Section
            title={`${selectedCommodity.name} specifications`}
            description={
              commodityParamDefs.length
                ? "Quality and logistics fields for this commodity"
                : "No extra fields for this commodity — use “Add custom field” if needed"
            }
          >
            <TradeParametersFields
              definitions={commodityParamDefs}
              values={tradeParams}
              onChange={(key, value) => setTradeParams((p) => ({ ...p, [key]: value }))}
              showAddCustom
              onAddCustomParam={(def) => setSessionParamDefs((d) => [...d, def])}
            />
          </Section>
        )}

        {isCorn && (
          <Section
            title="Specification"
            description="Quality tolerances for this corn trade — all values in percent"
          >
            <CornSpecificationFields values={cornSpecs} onChange={setCornSpecs} />
          </Section>
        )}

        <Field label="Internal notes (optional)" error={errors.notes?.message}>
          <textarea rows={2} {...register("notes")} className="kastros-select w-full" />
        </Field>

        {submitHint && <p className="text-sm text-warning">{submitHint}</p>}
        {Object.keys(errors).length > 0 && (
          <p className="text-sm text-kastros-red">
            {errors.commodityId?.message ||
              errors.counterpartyId?.message ||
              errors.originName?.message ||
              errors.productOrigin?.message ||
              errors.tradeDate?.message ||
              "Check required fields above."}
          </p>
        )}
        {book.error && <p className="text-sm text-kastros-red">{book.error.message}</p>}

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="button"
            onClick={makeSubmit(false)}
            disabled={isSubmitting || book.isPending}
            className="rounded-md border border-kastros-border bg-white/5 px-5 py-2 text-sm font-semibold text-foreground hover:bg-foreground/10 disabled:opacity-50"
          >
            {book.isPending && pendingAction === "draft" ? "Saving…" : "Save as draft"}
          </button>
          <button
            type="button"
            onClick={makeSubmit(true)}
            disabled={isSubmitting || book.isPending}
            className="rounded-md bg-brand px-5 py-2 text-sm font-semibold text-kastros-bg hover:opacity-90 disabled:opacity-50"
          >
            {book.isPending && pendingAction === "submit" ? "Submitting…" : "Submit to execution"}
          </button>
          <Link
            href="/trader/trades"
            className="rounded-md border border-kastros-border px-5 py-2 text-sm text-muted-foreground hover:bg-foreground/5"
          >
            Cancel
          </Link>
          <span className="text-xs text-subtle">
            Drafts stay in My Trades · Unfinished forms are autosaved under My Trades → Unfinished ·
            Submitting sends the trade to execution Unreviewed Trades for review and lock.
          </span>
          {lastDraftSavedAt && (
            <span className="text-xs text-subtle">
              Draft autosaved · {format(lastDraftSavedAt, "HH:mm")}
            </span>
          )}
        </div>
      </form>
      </div>
    </div>
  );
}
