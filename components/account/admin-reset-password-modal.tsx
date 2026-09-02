"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

type Props = {
  open: boolean;
  email: string;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (password: string) => void;
};

export function AdminResetPasswordModal({ open, email, busy, onClose, onSubmit }: Props) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPassword("");
      setConfirm("");
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-kastros-border bg-kastros-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Reset password</h3>
            <p className="mt-1 text-xs text-muted-foreground">{email}</p>
            <p className="mt-2 text-xs text-warning">
              Set a new temporary password — share privately with the user.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-subtle hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <label className="block text-xs text-subtle">
            New password (min 8 characters)
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label className="block text-xs text-subtle">
            Confirm new password
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="mt-1 w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-foreground"
            />
          </label>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-kastros-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-foreground/5 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || password.length < 8}
            onClick={() => {
              if (password !== confirm) {
                setError("Passwords do not match");
                return;
              }
              setError(null);
              onSubmit(password);
            }}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-kastros-bg hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Reset password"}
          </button>
        </div>
      </div>
    </div>
  );
}
