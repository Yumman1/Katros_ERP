"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { getHomeForRole } from "@/lib/routing";
import { signIn, getSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { KastrosLogo } from "@/components/branding/kastros-logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { formInputClass } from "@/lib/form-controls";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password required"),
});

type Form = z.infer<typeof schema>;

export default function LoginPage() {
  const searchParams = useSearchParams();
  const [err, setErr] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Form>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (data) => {
    setErr(null);
    const res = await signIn("credentials", {
      email: data.email,
      password: data.password,
      redirect: false,
    });
    if (res?.error) {
      setErr("Invalid email or password.");
      return;
    }
    const session = await getSession();
    const callbackUrl = searchParams.get("callbackUrl");
    const safeCallback =
      callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("/login")
        ? callbackUrl
        : null;
    const dest =
      safeCallback ?? (session?.user?.role ? getHomeForRole(session.user.role) : "/");
    window.location.assign(dest);
  });

  return (
    <div className="flex min-h-dvh">
      <div className="relative hidden w-[42%] kastros-brand-bar lg:flex lg:flex-col lg:justify-between lg:p-10">
        <div className="flex items-center gap-4">
          <KastrosLogo variant="icon" size="lg" />
          <KastrosLogo variant="full-white" size="lg" subtitle="Commodity Trading & Risk" />
        </div>
        <p className="max-w-sm text-sm leading-relaxed text-white/80">
          Manage trades, warehouse movements, positions, and finance in one unified CTRM platform.
        </p>
      </div>

      <div className="relative flex flex-1 flex-col items-center justify-center bg-background px-4 py-10">
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>

        <div className="mb-8 flex items-center gap-3 lg:hidden">
          <KastrosLogo variant="icon" size="md" />
          <KastrosLogo variant="full" size="lg" />
        </div>

        <div className="kastros-card w-full max-w-sm p-6">
          <h1 className="text-lg font-semibold text-foreground">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Access your trading or execution desk</p>
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Email</label>
              <input
                type="email"
                autoComplete="email"
                className={`${formInputClass} mt-1`}
                {...register("email")}
              />
              {errors.email && (
                <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Password</label>
              <input
                type="password"
                autoComplete="current-password"
                className={`${formInputClass} mt-1`}
                {...register("password")}
              />
              {errors.password && (
                <p className="mt-1 text-xs text-destructive">{errors.password.message}</p>
              )}
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <button type="submit" disabled={isSubmitting} className="kastros-btn-primary w-full">
              {isSubmitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Demo: <code className="text-brand">trader@kastros.co</code> ·{" "}
            <code className="text-brand">execution@kastros.co</code> ·{" "}
            <code className="text-brand">ceo@kastros.co</code> · password{" "}
            <code className="text-brand">demo</code>
          </p>
        </div>
      </div>
    </div>
  );
}
