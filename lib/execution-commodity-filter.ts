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

export function matchesCommodityFilter(
  commodityCode: string | null | undefined,
  filter: string,
): boolean {
  if (filter === "ALL") return true;
  return (commodityCode ?? "").trim() === filter;
}
