import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Full-height page shell — fixed chrome, scroll only in DeskScroll / table regions. */
export function DeskPage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("kastros-desk-page", className)}>{children}</div>;
}

/** Header, filters, KPI row — never scrolls. */
export function DeskToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("kastros-desk-toolbar", className)}>{children}</div>;
}

/** Scrollable panel for forms, approval queues, or multi-section content. */
export function DeskScroll({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("kastros-desk-scroll", className)}>{children}</div>;
}

/** Card with a scrollable body (tables, lists). */
export function DeskPanel({
  title,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={cn("kastros-panel-scroll", className)}>
      {title ? (
        <div className="kastros-panel-scroll-head shrink-0 border-b border-border px-3 py-2 text-sm font-medium text-muted-foreground">
          {title}
        </div>
      ) : null}
      <div className={cn("kastros-panel-scroll-body", bodyClassName)}>{children}</div>
    </div>
  );
}
