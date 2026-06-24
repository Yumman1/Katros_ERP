/** Canonical desk name used in mock seed data and booked trades. */
export const DEMO_TRADER_EMAIL = "trader@kastros.co";
export const DEMO_TRADER_NAME = "Ayesha Malik";

/** Normalize session/form trader keys so lists and bookTrade use the same name. */
export function canonicalTraderName(nameOrEmail: string): string {
  const raw = nameOrEmail.trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower === DEMO_TRADER_EMAIL || lower === DEMO_TRADER_NAME.toLowerCase()) {
    return DEMO_TRADER_NAME;
  }
  return raw;
}

export function traderNamesMatch(stored: string, lookup: string): boolean {
  return canonicalTraderName(stored) === canonicalTraderName(lookup);
}
