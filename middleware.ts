import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware() {
    return NextResponse.next();
  },
  {
    pages: { signIn: "/login" },
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  },
);

export const config = {
  matcher: [
    "/((?!login|warehouse/gatepass|api/auth|api/warehouse-gatepass|_next/static|_next/image|favicon.ico|branding).*)",
  ],
};
