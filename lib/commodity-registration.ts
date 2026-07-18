import { z } from "zod";
import { CommodityCategory } from "@prisma/client";
import { defaultCategoryForCommodityCode } from "@/lib/commodity-category";
import {
  defaultKgPerUnit,
  PRICE_CURRENCIES,
  type PriceCurrency,
} from "@/lib/price-units";
import type { TradeParamDefinition } from "@/lib/trade-parameters";

const quantityUnitSchema = z.string().trim().min(1);
const priceCurrencySchema = z.enum(PRICE_CURRENCIES);
const priceBasisConfigSchema = z.object({
  currency: priceCurrencySchema,
  weightUnit: z.string().trim().min(1),
  kgPerUnit: z.number().positive(),
});

export const tradeParamDefSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["text", "number", "percent", "select", "date", "textarea"]),
  group: z.enum(["contract", "quality", "logistics", "commercial"]),
  options: z.array(z.string()).optional(),
  placeholder: z.string().optional(),
  unit: z.string().optional(),
  required: z.boolean().optional(),
});

export const commodityCreateInputSchema = z.object({
  name: z.string().trim().min(1),
  code: z.string().trim().min(2).max(6),
  unit: quantityUnitSchema,
  category: z.nativeEnum(CommodityCategory).optional(),
  canonicalKgPerUnit: z.number().positive().optional(),
  priceUnits: z
    .object({
      LOCAL: priceBasisConfigSchema,
      INTERNATIONAL: priceBasisConfigSchema,
    })
    .optional(),
  tradeParameterDefs: z.array(tradeParamDefSchema).optional(),
});

export type CommodityCreateInput = z.infer<typeof commodityCreateInputSchema>;

export type CommodityFormState = {
  name: string;
  code: string;
  unit: string;
  localCurrency: PriceCurrency;
  localWeightUnit: string;
  localKgPerUnit: number;
  intlCurrency: PriceCurrency;
  intlWeightUnit: string;
  intlKgPerUnit: number;
  canonicalKgPerUnit: number;
};

export function emptyCommodityFormState(): CommodityFormState {
  return {
    name: "",
    code: "",
    unit: "MT",
    localCurrency: "PKR",
    localWeightUnit: "MAUND_40",
    localKgPerUnit: 40,
    intlCurrency: "USD",
    intlWeightUnit: "MT",
    intlKgPerUnit: 1000,
    canonicalKgPerUnit: 1000,
  };
}

export function buildCommodityCreatePayload(
  form: CommodityFormState,
  tradeParameterDefs: TradeParamDefinition[],
): CommodityCreateInput {
  const unit = form.unit.trim();
  return {
    name: form.name.trim(),
    code: form.code.trim().toUpperCase(),
    unit,
    category: defaultCategoryForCommodityCode(form.code),
    canonicalKgPerUnit: form.canonicalKgPerUnit || defaultKgPerUnit(unit),
    priceUnits: {
      LOCAL: {
        currency: form.localCurrency,
        weightUnit: form.localWeightUnit.trim() || unit,
        kgPerUnit: form.localKgPerUnit || defaultKgPerUnit(form.localWeightUnit),
      },
      INTERNATIONAL: {
        currency: form.intlCurrency,
        weightUnit: form.intlWeightUnit.trim() || unit,
        kgPerUnit: form.intlKgPerUnit || defaultKgPerUnit(form.intlWeightUnit),
      },
    },
    tradeParameterDefs: tradeParameterDefs.length ? tradeParameterDefs : undefined,
  };
}

export function commodityEntityRef(code: string): string {
  return `new-${code.trim().toUpperCase()}`;
}
