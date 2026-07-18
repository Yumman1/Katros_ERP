"use client";

import { useEffect, useMemo, useState } from "react";
import { LIST_PAGE_SIZE, paginateItems } from "@/lib/list-pagination";

export function useListPagination<T>(
  items: T[],
  options?: { pageSize?: number; resetKey?: string | number },
) {
  const pageSize = options?.pageSize ?? LIST_PAGE_SIZE;
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [items.length, options?.resetKey]);

  const result = useMemo(() => paginateItems(items, page, pageSize), [items, page, pageSize]);

  useEffect(() => {
    if (page > result.totalPages) setPage(result.totalPages);
  }, [page, result.totalPages]);

  return { ...result, setPage };
}
