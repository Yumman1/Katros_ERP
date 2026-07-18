"use client";

import { WarehouseSubnav } from "@/components/execution/warehouse-subnav";
import { PageHeader } from "@/components/ui/page-header";
import { Building2, Gauge, Pencil, Plus } from "lucide-react";
import Link from "next/link";

const CARDS = [
  {
    href: "/execution/warehouses/setup",
    title: "Setup & details",
    description: "Create new warehouses and view master data — name, code, capacity, address.",
    icon: Plus,
  },
  {
    href: "/execution/warehouses/utilization",
    title: "Utilization & costing",
    description: "Track sq ft usage, on-hand stock, and monthly cost per maund at 70% / 100% utilization.",
    icon: Gauge,
  },
  {
    href: "/execution/warehouses/manage",
    title: "Update & delete",
    description: "Request warehouse changes or removal — head of execution approves via Approvals.",
    icon: Pencil,
  },
] as const;

export default function WarehousesHubPage() {
  return (
    <div className="kastros-desk-page">
      <PageHeader
        breadcrumb={
          <>
            <Link href="/execution" className="hover:text-foreground">
              Desk
            </Link>
            <span>/</span>
            <span className="text-muted-foreground">Warehouses</span>
          </>
        }
        title="Warehouses"
        subtitle="Master data, utilization, and governed updates for company storage locations."
        actions={
          <Link href="/execution/inventory" className="kastros-btn-secondary inline-flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Inventory
          </Link>
        }
      />

      <WarehouseSubnav />

      <div className="grid gap-4 md:grid-cols-3">
        {CARDS.map(({ href, title, description, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-accent-secondary/40 hover:bg-accent-secondary-muted/30"
          >
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-accent-secondary-muted text-accent-secondary">
              <Icon className="h-5 w-5" />
            </div>
            <h2 className="text-sm font-semibold text-foreground group-hover:text-accent-secondary">{title}</h2>
            <p className="mt-1 text-xs text-subtle">{description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
