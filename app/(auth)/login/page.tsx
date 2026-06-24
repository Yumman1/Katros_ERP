"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { getHomeForRole } from "@/lib/routing";
import { signIn, getSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password required"),
});

type Form = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
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
    const dest = session?.user?.role ? getHomeForRole(session.user.role) : "/";
    router.push(dest);
    router.refresh();
  });

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-kastros-bg px-4">
      <div className="w-full max-w-sm rounded-lg border border-kastros-border bg-kastros-card p-6 shadow-xl">
        <h1 className="text-center text-xl font-semibold text-white">Kastros CTRM</h1>
        <p className="mt-1 text-center text-sm text-zinc-500">Sign in to your desk</p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-zinc-400">Email</label>
            <input
              type="email"
              autoComplete="email"
              className="mt-1 w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-white outline-none focus:border-kastros-green"
              {...register("email")}
            />
            {errors.email && (
              <p className="mt-1 text-xs text-kastros-red">{errors.email.message}</p>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-400">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              className="mt-1 w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-white outline-none focus:border-kastros-green"
              {...register("password")}
            />
            {errors.password && (
              <p className="mt-1 text-xs text-kastros-red">{errors.password.message}</p>
            )}
          </div>
          {err && <p className="text-sm text-kastros-red">{err}</p>}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-kastros-green py-2 text-sm font-medium text-kastros-bg hover:opacity-90 disabled:opacity-50"
          >
            {isSubmitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-zinc-500">
          Trader: <code className="text-kastros-green">trader@kastros.co</code> · Execution:{" "}
          <code className="text-kastros-green">execution@kastros.co</code> · Finance:{" "}
          <code className="text-kastros-green">finance@kastros.co</code> +{" "}
          <code className="text-kastros-green">demo</code>
          <br />
          Mock mode: any email + <code className="text-kastros-green">demo</code> or{" "}
          <code className="text-kastros-green">Kastros123!</code>
        </p>
      </div>
    </div>
  );
}
