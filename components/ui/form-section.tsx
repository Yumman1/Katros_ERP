"use client";

import type { ReactNode } from "react";

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-kastros-border/60 pb-5 last:border-0">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-subtle">{description}</p>}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function FormField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="mt-1">{children}</div>
      {error && <p className="mt-1 text-xs text-kastros-red">{error}</p>}
    </div>
  );
}
