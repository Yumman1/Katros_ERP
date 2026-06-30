import { LockedContractsPage } from "@/components/execution/locked-contracts-page";
import { Suspense } from "react";

export default function ContractsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
          Loading contracts…
        </div>
      }
    >
      <LockedContractsPage />
    </Suspense>
  );
}
