export type CommodityOption = { code: string; name: string };

export function collectCommodityOptions(
  sources: { commodityCode?: string | null; commodityName?: string | null }[],
): CommodityOption[] {
  const map = new Map<string, string>();
  for (const s of sources) {
    const code = s.commodityCode?.trim();
    if (!code) continue;
    map.set(code, s.commodityName?.trim() || code);
  }
  return [...map.entries()]
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Only commodities with open contract volume or unassigned trucks (post-assignment filter). */
export function collectDeskCommodityOptions(input: {
  contracts: { commodityCode?: string | null; commodityName?: string | null; openQtyMt?: number }[];
  trucks: { commodityCode?: string | null; commodityName?: string | null; status?: string }[];
}): CommodityOption[] {
  const counts = new Map<string, { name: string; count: number }>();

  for (const c of input.contracts) {
    const code = c.commodityCode?.trim();
    if (!code || (c.openQtyMt ?? 0) <= 0) continue;
    const prev = counts.get(code);
    counts.set(code, { name: c.commodityName?.trim() || code, count: (prev?.count ?? 0) + 1 });
  }

  for (const t of input.trucks) {
    if (t.status === "ASSIGNED") continue;
    const code = t.commodityCode?.trim();
    if (!code) continue;
    const prev = counts.get(code);
    counts.set(code, { name: t.commodityName?.trim() || code, count: (prev?.count ?? 0) + 1 });
  }

  return [...counts.entries()]
    .filter(([, v]) => v.count > 0)
    .map(([code, v]) => ({ code, name: v.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function matchesCommodityFilter(
  commodityCode: string | null | undefined,
  filter: string,
): boolean {
  if (filter === "ALL") return true;
  return (commodityCode ?? "").trim() === filter;
}
