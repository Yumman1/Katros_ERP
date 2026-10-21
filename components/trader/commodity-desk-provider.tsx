"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc/client";
import { isSesameCommodity } from "@/lib/sesame";
import { type SesameEntity } from "@/lib/sesame-entity";

type Desk = { id: string; code: string; name: string };
type DeskContext = {
  desks: Desk[];
  active: Desk | undefined;
  select: (id: string) => void;
  loading: boolean;
  error: string | undefined;
  entity: SesameEntity;
  selectEntity: (entity: SesameEntity) => void;
  sesame: boolean;
  query: { commodityId?: string; entity?: SesameEntity };
};
const Context = createContext<DeskContext | null>(null);

export function CommodityDeskProvider({ children }: { children: ReactNode }) {
  const query = trpc.trader.myCommodityDesks.useQuery(undefined, { refetchInterval: 30_000, refetchOnWindowFocus: "always", retry: false });
  const [selected, select] = useState("");
  const [selectedEntity, setSelectedEntity] = useState<SesameEntity>("PAK");
  useEffect(() => {
    try {
      if (localStorage.getItem("sesame-trader-entity") === "FZCO") setSelectedEntity("FZCO");
    } catch { /* optional storage */ }
  }, []);
  const desks = query.error ? [] : query.data ?? [];
  // A revoked desk disappears immediately on refresh, including its cached panels.
  const active = desks.find(d => d.id === selected) ?? desks[0];
  const sesame = Boolean(active && isSesameCommodity(active.code));
  const entity: SesameEntity = sesame ? selectedEntity : "PAK";
  const selectEntity = (next: SesameEntity) => {
    try { localStorage.setItem("sesame-trader-entity", next); } catch { /* optional storage */ }
    setSelectedEntity(next);
  };
  return (
    <Context.Provider
      value={{
        desks,
        active,
        select,
        loading: query.isLoading,
        error: query.error?.message,
        entity,
        selectEntity,
        sesame,
        query: { commodityId: active?.id, ...(sesame ? { entity } : {}) },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useCommodityDesk() {
  const value = useContext(Context);
  if (!value) throw new Error("Commodity desk provider is missing");
  return value;
}
