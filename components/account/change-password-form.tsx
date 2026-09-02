"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const changePassword = trpc.account.changePassword.useMutation({
    onSuccess: () => {
      setNotice("Password updated. Use your new password the next time you sign in.");
      setError(null);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (e: { message: string }) => {
      setError(e.message);
      setNotice(null);
    },
  });

  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    confirmPassword === newPassword &&
    !changePassword.isPending;

  return (
    <form
      className="max-w-md space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setNotice(null);
        setError(null);
        if (newPassword !== confirmPassword) {
          setError("New passwords do not match");
          return;
        }
        changePassword.mutate({ currentPassword, newPassword });
      }}
    >
      <label className="block text-xs text-subtle">
        Current password
        <input
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="mt-1 w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-foreground"
        />
      </label>
      <label className="block text-xs text-subtle">
        New password (min 8 characters)
        <input
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="mt-1 w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-foreground"
        />
      </label>
      <label className="block text-xs text-subtle">
        Confirm new password
        <input
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="mt-1 w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-foreground"
        />
      </label>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {notice ? <p className="text-sm text-success">{notice}</p> : null}

      <button
        type="submit"
        disabled={!canSubmit}
        className="kastros-btn-primary text-sm disabled:opacity-50"
      >
        {changePassword.isPending ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
