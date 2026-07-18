import { authOptions } from "@/lib/auth";
import { getHomeForRole } from "@/lib/routing";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** App entry — unauthenticated users go to login; authenticated users go to their desk. */
export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.role) redirect("/login");
  redirect(getHomeForRole(session.user.role));
}
