import { CommodityCategory } from "@prisma/client";
import { isCornCommodity, isGrainCommodityCode } from "@/lib/trade-constants";

/** Shared commodity category inference for registration and master data. */
export function defaultCategoryForCommodityCode(code: string): CommodityCategory {
  const upper = code.trim().toUpperCase();
  if (isCornCommodity(upper) || isGrainCommodityCode(upper)) return CommodityCategory.GRAINS;
  if (["CTN", "COT", "COTTON", "AFC"].includes(upper)) return CommodityCategory.SOFTS;
  if (["CPO", "PALM"].some((k) => upper.includes(k))) return CommodityCategory.VEGOIL;
  if (["SOY", "SOYBEANS", "CANOLA"].some((k) => upper.includes(k))) return CommodityCategory.OILSEEDS;
  return CommodityCategory.OTHER;
}

/** @deprecated Prefer defaultCategoryForCommodityCode */
export const defaultCommodityCategoryFromCode = defaultCategoryForCommodityCode;
