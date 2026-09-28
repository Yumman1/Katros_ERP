"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { trpc } from "@/lib/trpc/client";

type Desk = { id: string; code: string; name: string };
const Context = createContext<{ desks: Desk[]; active: Desk; select: (code: string) => void } | null>(null);

export function ExecutionCommodityDeskProvider({ children }: { children: ReactNode }) {
  const desks = trpc.execution.commodityDesks.useQuery(undefined, { retry: false, refetchOnWindowFocus: true });
  const router = useRouter();
  const pathname = usePathname();
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    try { setSelected(localStorage.getItem("execution-commodity") ?? ""); }
    catch { setSelected(""); }
  }, []);
  // A direct link / print window identifies its own commodity before fetching its record.
  const match = pathname.match(/\/(?:open-trades|purchase-delivered|purchase-spot|sales|print\/trade)\/([^/]+)$/)
    ?? pathname.match(/\/contracts\/([^/]+)\/edit$/);
  const truck = pathname.match(/\/print\/(?:delivery-order|gate-out-slip)\/([^/]+)$/);
  const target = trpc.execution.referenceDesk.useQuery(
    { tradeRef: match ? decodeURIComponent(match[1]) : undefined, truckId: truck ? decodeURIComponent(truck[1]) : undefined },
    { enabled: Boolean(match || truck), retry: false },
  );
  if (desks.error) return <p role="alert" className="p-6 text-destructive">{desks.error.message}</p>;
  if (selected === null || desks.isLoading || ((match || truck) && target.isLoading)) return <p className="p-6">Loading execution desk…</p>;
  const list = desks.data ?? [];
  const active = list.find(d => d.code === (target.data ?? selected)) ?? list[0];
  if (!active) return <p className="p-6">No commodities have been registered.</p>;
  const select = (code: string) => {
    if (code === active.code) return;
    try { localStorage.setItem("execution-commodity", code); } catch { /* Storage may be disabled. */ }
    setSelected(code);
    // Leave record-specific pages and discard any form tied to the old commodity.
    router.push("/execution");
  };
  return <Context.Provider value={{ desks: list, active, select }}>
    <ScopedExecutionClient key={active.code} code={active.code}>{children}</ScopedExecutionClient>
  </Context.Provider>;
}

function ScopedExecutionClient({ code, children }: { code: string; children: ReactNode }) {
  // Separate caches and fixed headers prevent late responses or mutations from
  // one desk from being displayed in, or sent on behalf of, another desk.
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: true } } }));
  const [client] = useState(() => trpc.createClient({ links: [httpBatchLink({ url: "/api/trpc", transformer: superjson, headers: { "x-execution-commodity": code } })] }));
  return <trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></trpc.Provider>;
}

export function useExecutionCommodityDesk() {
  const desk = useContext(Context);
  if (!desk) throw new Error("Execution commodity desk is missing");
  return desk;
}

export function ExecutionCommoditySwitcher() {
  const { desks, active, select } = useExecutionCommodityDesk();
  return <div className="mx-4 mb-3 mt-3">
    <label htmlFor="execution-commodity" className="mb-1.5 block text-xs font-medium text-muted-foreground">Execution commodity</label>
    <select id="execution-commodity" className="kastros-select w-full" value={active.code} onChange={e => select(e.target.value)}>
      {desks.map(d => <option key={d.id} value={d.code}>{d.name} — {d.code}</option>)}
    </select>
  </div>;
}
