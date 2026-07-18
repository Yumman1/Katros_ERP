import { LockedContractsPage } from "@/components/execution/locked-contracts-page";
import { Suspense } from "react";

export default function ContractsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full min-h-0 flex-1 items-center justify-center text-sm text-subtle">
          Loading contracts…
        </div>
      }
    >
      <LockedContractsPage />
    </Suspense>
  );
}
