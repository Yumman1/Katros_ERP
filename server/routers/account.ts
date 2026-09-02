import bcrypt from "bcryptjs";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "@/server/db";
import { protectedProcedure, router } from "@/server/trpc/trpc";

export const accountRouter = router({
  /** Signed-in user changes their own password (requires current password). */
  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1, "Current password is required"),
        newPassword: z.string().min(8, "New password must be at least 8 characters"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.currentPassword === input.newPassword) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "New password must be different from your current password",
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: ctx.session.user.id },
        select: { id: true, passwordHash: true, disabled: true },
      });
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }
      if (user.disabled) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This account is disabled" });
      }

      const valid = await bcrypt.compare(input.currentPassword, user.passwordHash);
      if (!valid) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Current password is incorrect",
        });
      }

      const passwordHash = await bcrypt.hash(input.newPassword, 12);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });

      return { ok: true as const };
    }),
});
