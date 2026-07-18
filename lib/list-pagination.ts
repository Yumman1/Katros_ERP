export const LIST_PAGE_SIZE = 10;

export function paginateItems<T>(items: T[], page: number, pageSize = LIST_PAGE_SIZE) {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  const end = Math.min(start + pageSize, totalItems);

  return {
    items: items.slice(start, end),
    page: safePage,
    totalPages,
    totalItems,
    pageSize,
    startIndex: totalItems ? start + 1 : 0,
    endIndex: end,
    hasPrev: safePage > 1,
    hasNext: safePage < totalPages,
  };
}
