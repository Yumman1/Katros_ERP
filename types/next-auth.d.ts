import type { DefaultSession } from "next-auth";
import type { Role } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      role: Role;
      /** Whether this user is the head/lead of their department. */
      isHead: boolean;
    };
  }

  interface User {
    role: Role;
    isHead?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: Role;
    isHead?: boolean;
  }
}
