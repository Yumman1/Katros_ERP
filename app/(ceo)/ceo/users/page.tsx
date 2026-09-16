"use client";

import { SearchableSelect } from "@/components/ui/searchable-select";

import { useRecordFilters } from "@/components/ui/record-filters";
import { field } from "@/lib/record-filters";

import { useMemo, useState } from "react";
import { KeyRound, ShieldCheck, UserPlus, UserX, Users as UsersIcon, Wifi } from "lucide-react";
import { AdminResetPasswordModal } from "@/components/account/admin-reset-password-modal";
import { PageHeader } from "@/components/ui/page-header";
import { trpc } from "@/lib/trpc/client";

const ROLE_OPTIONS = [
  { value: "TRADER", label: "Trader" },
  { value: "EXECUTION", label: "Execution" },
  { value: "FINANCE", label: "Finance" },
  { value: "RISK_MANAGER", label: "Risk manager" },
  { value: "READ_ONLY", label: "Read only" },
  { value: "CEO", label: "CEO" },
] as const;

type RoleValue = (typeof ROLE_OPTIONS)[number]["value"];

const ROLE_LABELS: Record<string, string> = Object.fromEntries(
  ROLE_OPTIONS.map((r) => [r.value, r.label]),
);

const ACTIVE_WINDOW_MS = 5 * 60 * 1000;

function lastSeenLabel(lastSeenAt: Date | null): string {
  if (!lastSeenAt) return "Never";
  const mins = Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return new Date(lastSeenAt).toLocaleDateString();
}

function isActiveNow(lastSeenAt: Date | null): boolean {
  return !!lastSeenAt && Date.now() - new Date(lastSeenAt).getTime() < ACTIVE_WINDOW_MS;
}

const emptyForm = {
  name: "",
  email: "",
  password: "",
  role: "TRADER" as RoleValue,
  isHead: false,
};

export default function CeoUsersPage() {
  const utils = trpc.useUtils();
  const users = trpc.ceo.users.useQuery(undefined, { refetchInterval: 30_000 });
  const active = trpc.ceo.activeUsers.useQuery(undefined, { refetchInterval: 30_000 });

  const [form, setForm] = useState(emptyForm);
  const [showActiveList, setShowActiveList] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<{ id: string; email: string } | null>(null);

  const refresh = () => {
    void utils.ceo.users.invalidate();
    void utils.ceo.activeUsers.invalidate();
  };

  const createUser = trpc.ceo.createUser.useMutation({
    onSuccess: (u) => {
      setNotice(`${u.name} (${u.email}) can now log in — their ${ROLE_LABELS[u.role] ?? u.role} workspace opens automatically.`);
      setError(null);
      setForm(emptyForm);
      refresh();
    },
    onError: (e) => setError(e.message),
  });

  const updateUser = trpc.ceo.updateUser.useMutation({
    onSuccess: (_data, variables) => {
      setError(null);
      if (variables.password) {
        setNotice(`Password reset for ${resetTarget?.email ?? "user"}.`);
        setResetTarget(null);
      }
      refresh();
    },
    onError: (e) => setError(e.message),
  });

  const totals = useMemo(() => {
    const all = users.data ?? [];
    return {
      total: all.length,
      enabled: all.filter((u) => !u.disabled).length,
      heads: all.filter((u) => u.isHead && !u.disabled).length,
    };
  }, [users.data]);

  const listFilters = useRecordFilters("users", users.data, { fields: [field("role", "Role"), field("disabled", "Disabled"), field("isHead", "Department head")], searchPaths: ["name", "email"] });

  return (
    <div className="kastros-desk-page mx-auto max-w-5xl">
      <PageHeader
        title="Users"
        subtitle="Create accounts, assign roles and department-head rights. Each person lands in their role's workspace when they log in."
      />

      <div className="kastros-desk-scroll space-y-5 pb-6">
        {/* ── Stat tiles ── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-kastros-border bg-kastros-card p-4">
            <div className="flex items-center gap-2 text-xs text-subtle">
              <UsersIcon className="h-3.5 w-3.5" /> Total users
            </div>
            <div className="mt-1 text-2xl font-semibold text-foreground">{totals.total}</div>
          </div>
          <button
            type="button"
            onClick={() => setShowActiveList((v) => !v)}
            className={`rounded-xl border p-4 text-left transition-colors ${
              showActiveList
                ? "border-success bg-success/10"
                : "border-kastros-border bg-kastros-card hover:border-success/60"
            }`}
          >
            <div className="flex items-center gap-2 text-xs text-subtle">
              <Wifi className="h-3.5 w-3.5 text-success" /> Active now
            </div>
            <div className="mt-1 text-2xl font-semibold text-success">
              {active.data?.count ?? "—"}
            </div>
            <div className="mt-0.5 text-[10px] text-subtle">last 5 minutes — click to view</div>
          </button>
          <div className="rounded-xl border border-kastros-border bg-kastros-card p-4">
            <div className="flex items-center gap-2 text-xs text-subtle">
              <ShieldCheck className="h-3.5 w-3.5" /> Department heads
            </div>
            <div className="mt-1 text-2xl font-semibold text-foreground">{totals.heads}</div>
          </div>
          <div className="rounded-xl border border-kastros-border bg-kastros-card p-4">
            <div className="flex items-center gap-2 text-xs text-subtle">
              <UserX className="h-3.5 w-3.5" /> Disabled
            </div>
            <div className="mt-1 text-2xl font-semibold text-foreground">
              {totals.total - totals.enabled}
            </div>
          </div>
        </div>

        {/* ── Active users list (toggled by the tile) ── */}
        {showActiveList && (
          <section className="rounded-xl border border-success/40 bg-kastros-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Currently on the system</h2>
            {(active.data?.users.length ?? 0) === 0 ? (
              <p className="mt-2 text-sm text-subtle">No one has been active in the last 5 minutes.</p>
            ) : (
              <div className="kastros-table-wrap mt-3">
                <table className="w-full border-collapse text-sm">
                  <thead className="text-left text-xs uppercase text-subtle">
                    <tr>
                      <th className="border-b border-kastros-border px-2 py-2">Name</th>
                      <th className="border-b border-kastros-border px-2 py-2">Email</th>
                      <th className="border-b border-kastros-border px-2 py-2">Role</th>
                      <th className="border-b border-kastros-border px-2 py-2">Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.data?.users.map((u) => (
                      <tr key={u.id} className="border-b border-kastros-border/60">
                        <td className="px-2 py-1.5">
                          <span className="mr-2 inline-block h-2 w-2 rounded-full bg-success" />
                          {u.name ?? "—"}
                        </td>
                        <td className="px-2 py-1.5">{u.email}</td>
                        <td className="px-2 py-1.5">{ROLE_LABELS[u.role] ?? u.role}</td>
                        <td className="px-2 py-1.5 text-subtle">{lastSeenLabel(u.lastSeenAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {notice && (
          <div className="rounded-lg border border-success/40 bg-success/10 px-4 py-2.5 text-sm text-success">
            {notice}
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-2.5 text-sm text-danger">
            {error}
          </div>
        )}

        {/* ── Create user ── */}
        <section className="rounded-xl border border-kastros-border bg-kastros-card p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <UserPlus className="h-4 w-4" /> Register new user
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-xs text-subtle">
              Full name
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1 w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-foreground"
                placeholder="e.g. Bilal Ahmed"
              />
            </label>
            <label className="block text-xs text-subtle">
              Email (their login)
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="mt-1 w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-foreground"
                placeholder="name@kastros.com"
              />
            </label>
            <label className="block text-xs text-subtle">
              Temporary password (min 8 chars)
              <input
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="mt-1 w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-foreground"
                placeholder="Share with the user privately"
              />
            </label>
            <label className="block text-xs text-subtle">
              Role — decides which workspace opens on login
              <SearchableSelect
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as RoleValue })}
                className="mt-1 w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-foreground"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </SearchableSelect>
            </label>
            <label className="mt-5 flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.isHead}
                onChange={(e) => setForm({ ...form, isHead: e.target.checked })}
              />
              Department head (approves their team&apos;s change requests)
            </label>
          </div>
          <button
            type="button"
            disabled={
              createUser.isPending ||
              !form.name.trim() ||
              !form.email.trim() ||
              form.password.length < 8
            }
            onClick={() => {
              setNotice(null);
              createUser.mutate(form);
            }}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-kastros-bg disabled:opacity-50"
          >
            <UserPlus className="h-4 w-4" />
            {createUser.isPending ? "Creating…" : "Create user"}
          </button>
        </section>

        {/* ── All users ── */}
        <section className="rounded-xl border border-kastros-border bg-kastros-card p-5">
          <h2 className="text-sm font-semibold text-foreground">All users</h2>
            {listFilters.controls}
          <div className="kastros-table-wrap mt-3">
            <table className="w-full border-collapse text-sm">
              <thead className="text-left text-xs uppercase text-subtle">
                <tr>
                  <th className="border-b border-kastros-border px-2 py-2">Name</th>
                  <th className="border-b border-kastros-border px-2 py-2">Email</th>
                  <th className="border-b border-kastros-border px-2 py-2">Role</th>
                  <th className="border-b border-kastros-border px-2 py-2">Head</th>
                  <th className="border-b border-kastros-border px-2 py-2">Last seen</th>
                  <th className="border-b border-kastros-border px-2 py-2">Status</th>
                  <th className="border-b border-kastros-border px-2 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {listFilters.rows.map((u) => (
                  <tr key={u.id} className={`border-b border-kastros-border/60 ${u.disabled ? "opacity-50" : ""}`}>
                    <td className="px-2 py-1.5">
                      {isActiveNow(u.lastSeenAt) && (
                        <span className="mr-2 inline-block h-2 w-2 rounded-full bg-success" />
                      )}
                      {u.name ?? "—"}
                    </td>
                    <td className="px-2 py-1.5">{u.email}</td>
                    <td className="px-2 py-1.5">
                      <SearchableSelect
                        value={u.role}
                        disabled={updateUser.isPending}
                        onChange={(e) =>
                          updateUser.mutate({ id: u.id, role: e.target.value as RoleValue })
                        }
                        className="rounded-md border border-kastros-border bg-kastros-bg px-2 py-1 text-xs text-foreground"
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                        {u.role === "ADMIN" && <option value="ADMIN">Admin (legacy)</option>}
                      </SearchableSelect>
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={u.isHead}
                        disabled={updateUser.isPending}
                        onChange={(e) => updateUser.mutate({ id: u.id, isHead: e.target.checked })}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-subtle">{lastSeenLabel(u.lastSeenAt)}</td>
                    <td className="px-2 py-1.5">
                      {u.disabled ? (
                        <span className="text-xs text-danger">Disabled</span>
                      ) : isActiveNow(u.lastSeenAt) ? (
                        <span className="text-xs text-success">Active now</span>
                      ) : (
                        <span className="text-xs text-subtle">Enabled</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          title="Reset password"
                          disabled={updateUser.isPending}
                          onClick={() => setResetTarget({ id: u.id, email: u.email })}
                          className="rounded-md border border-kastros-border px-2 py-1 text-xs text-foreground hover:bg-kastros-bg"
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={updateUser.isPending}
                          onClick={() => updateUser.mutate({ id: u.id, disabled: !u.disabled })}
                          className={`rounded-md border px-2 py-1 text-xs ${
                            u.disabled
                              ? "border-success/50 text-success hover:bg-success/10"
                              : "border-danger/50 text-danger hover:bg-danger/10"
                          }`}
                        >
                          {u.disabled ? "Enable" : "Disable"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <AdminResetPasswordModal
        open={resetTarget != null}
        email={resetTarget?.email ?? ""}
        busy={updateUser.isPending}
        onClose={() => setResetTarget(null)}
        onSubmit={(password) => {
          if (!resetTarget) return;
          updateUser.mutate({ id: resetTarget.id, password });
        }}
      />
    </div>
  );
}
