import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  title: ReactNode;
  subtitle?: string;
  breadcrumb?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({ title, subtitle, breadcrumb, actions, className }: Props) {
  return (
    <div className={cn("kastros-page-header flex flex-wrap items-start justify-between gap-4", className)}>
      <div>
        {breadcrumb ? (
          <div className="mb-2 flex items-center gap-2 text-xs text-subtle">{breadcrumb}</div>
        ) : null}
        <h1 className="kastros-page-title">{title}</h1>
        {subtitle ? <p className="kastros-page-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
