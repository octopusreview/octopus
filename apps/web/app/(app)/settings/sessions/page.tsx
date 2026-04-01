import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SessionsClient } from "./sessions-client";

export default async function SessionsPage() {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session) redirect("/login");

  const sessions = await auth.api.listSessions({ headers: reqHeaders });

  return (
    <SessionsClient
      sessions={sessions.map((s) => ({
        id: s.id,
        token: s.token,
        ipAddress: s.ipAddress ?? null,
        userAgent: s.userAgent ?? null,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
      }))}
      currentSessionToken={session.session.token}
    />
  );
}
