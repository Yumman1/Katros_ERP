"use client";
import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
export default function Page() { return <Suspense fallback={<p>Opening internal gate register…</p>}><OpenGate /></Suspense>; }
function OpenGate() {
  const direction = useSearchParams().get("direction") === "in" ? "in" : "out";
  const { data, error } = trpc.execution.internalGateLink.useQuery();
  useEffect(() => { if (data) window.location.replace(`${data.href}&direction=${direction}`); }, [data, direction]);
  return <p role={error ? "alert" : "status"}>{error?.message ?? "Opening internal warehouse gate register…"}</p>;
}
