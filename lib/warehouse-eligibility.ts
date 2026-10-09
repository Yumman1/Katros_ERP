import { isSesameCommodity } from "./sesame";
/** Known desk allocations. Shared warehouses remain available to both commodities. */
export function warehouseAllowedForCommodity(name: string, code?: string | null) {
  if (code?.toUpperCase() === "CORN" && /^(silver\s+wh|ma\s+oil)$/i.test(name.trim())) return false;
  return !(isSesameCommodity(code) && /^faqir(?:\s+warehouse)?$/i.test(name.trim()));
}
