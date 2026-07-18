import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/server/db";
import { isMockMode } from "@/server/mock-mode";
import { mockCredentialsUser } from "@/server/dummy-data";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;
        if (!email || !password) return null;

        // Primary path: validate against the database user table.
        let user: Awaited<ReturnType<typeof prisma.user.findUnique>> = null;
        try {
          user = await prisma.user.findUnique({ where: { email } });
        } catch (err) {
          // DB unreachable — only tolerated in mock mode (dev without a DB).
          if (!isMockMode()) throw err;
        }

        if (user) {
          if (user.disabled) return null;
          const ok = await bcrypt.compare(password, user.passwordHash);
          if (!ok) return null;
          return {
            id: user.id,
            email: user.email,
            name: user.name ?? undefined,
            role: user.role,
            isHead: user.isHead,
          };
        }

        // Dev fallback: MOCK_MODE=true and the email has no DB row —
        // derive a demo identity from the email pattern.
        if (isMockMode()) {
          const demoOk = password === "demo" || password === "Kastros123!";
          if (!demoOk) return null;
          return mockCredentialsUser(email);
        }

        return null;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.isHead = user.isHead ?? false;
        token.sub = user.id;
        token.name = user.name;
        token.email = user.email;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.role = token.role ?? "READ_ONLY";
        session.user.isHead = token.isHead ?? false;
        if (token.name) session.user.name = token.name as string;
        if (token.email) session.user.email = token.email as string;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
