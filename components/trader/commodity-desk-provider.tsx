"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc/client";

type Desk = { id: string; code: string; name: string };
type DeskContext = { desks: Desk[]; active: Desk | undefined; select: (id: string) => void; loading: boolean; error: string | undefined };
const Context = createContext<DeskContext | null>(null);

export function CommodityDeskProvider({ children }: { children: ReactNode }) {
  const query = trpc.trader.myCommodityDesks.useQuery(undefined, { refetchInterval: 30_000, refetchOnWindowFocus: "always", retry: false });
  const [selected, select] = useState("");
  const desks = query.error ? [] : query.data ?? [];
  // A revoked desk disappears immediately on refresh, including its cached panels.
  const active = desks.find(d => d.id === selected) ?? desks[0];
  return <Context.Provider value={{ desks, active, select, loading: query.isLoading, error: query.error?.message }}>{children}</Context.Provider>;
}
export function useCommodityDesk() {
  const value = useContext(Context);
  if (!value) throw new Error("Commodity desk provider is missing");
  return value;
}
