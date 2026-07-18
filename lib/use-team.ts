"use client";

import { useSession } from "next-auth/react";
import { departmentForRole, type Department } from "@/lib/departments";
import type { Role } from "@prisma/client";

export type TeamContext = {
  role: Role | null;
  isHead: boolean;
  department: Department | null;
  name: string | null;
};

/** Client-side department/head context derived from the NextAuth session. */
export function useTeam(): TeamContext {
  const { data } = useSession();
  const role = (data?.user?.role as Role | undefined) ?? null;
  const isHead = data?.user?.isHead ?? false;
  return {
    role,
    isHead,
    department: role ? departmentForRole(role) : null,
    name: data?.user?.name ?? null,
  };
}
