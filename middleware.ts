import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: { signIn: "/login" },
});

export const config = {
  matcher: [
    "/((?!login|warehouse/gatepass|api/auth|api/warehouse-gatepass|_next/static|_next/image|favicon.ico).*)",
  ],
};
