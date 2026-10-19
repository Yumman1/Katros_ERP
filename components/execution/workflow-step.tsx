"use client";

import { AlertTriangle, Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** "warn" = completed with a caveat (Check badge, warning colours). */
export type StepState = "done" | "active" | "waiting" | "error" | "warn";

export function StepPanel({
  step,
  title,
  state,
  headline,
  children,
}: {
  step: number;
  title: string;
  state: StepState;
  /** Short status text shown at the right of the header. */
  headline?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-lg border p-3",
        state === "done" && "border-success/40 bg-success/[0.06]",
        state === "warn" && "border-warning/40 bg-warning/[0.06]",
        state === "error" && "border-destructive/40 bg-destructive/[0.06]",
        state === "active" && "border-kastros-border bg-kastros-bg/60",
        state === "waiting" && "border-dashed border-kastros-border/70 bg-transparent opacity-70",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
            state === "done" && "bg-success text-white",
            state === "warn" && "bg-warning text-white",
            state === "error" && "bg-destructive text-white",
            state === "active" && "border border-kastros-border text-muted-foreground",
            state === "waiting" && "border border-dashed border-kastros-border text-subtle",
          )}
        >
          {state === "done" || state === "warn" ? <Check className="h-3 w-3" /> : step}
        </span>
        <span className="text-[11px] font-bold uppercase tracking-wider text-foreground">{title}</span>
        {headline && (
          <span
            className={cn(
              "ml-auto truncate text-[11px] font-medium",
              state === "done" && "text-success",
              state === "warn" && "text-warning",
              state === "error" && "text-destructive",
              (state === "active" || state === "waiting") && "text-subtle",
            )}
          >
            {headline}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

export function ErrorLine({ message }: { message: string }) {
  return (
    <span className="flex items-start gap-1 text-[10px] text-destructive">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
      {message}
    </span>
  );
}

export function WorkflowCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-kastros-border bg-kastros-card p-3.5 shadow-sm">{children}</div>
  );
}
