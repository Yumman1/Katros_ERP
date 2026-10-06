import { isSesameCommodity } from "./sesame";
/** Faqir is a Corn location. Keep its historical records and other desks intact. */
export function warehouseAllowedForCommodity(name: string, code?: string | null) {
  return !(isSesameCommodity(code) && /^faqir(?:\s+warehouse)?$/i.test(name.trim()));
}
