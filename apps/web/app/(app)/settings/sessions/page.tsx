import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { APIError } from "better-auth/api";
import Link from "next/link";
import { SessionsClient } from "./sessions-client";

export default async function SessionsPage() {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session) redirect("/login");

  let sessions: Awaited<ReturnType<typeof auth.api.listSessions>>;
  try {
    sessions = await auth.api.listSessions({ headers: reqHeaders });
  } catch (error) {
    if (!(error instanceof APIError) || error.body?.code !== "SESSION_NOT_FRESH") throw error;
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Sign in again to manage sessions</h1>
        <p className="text-muted-foreground">For security, managing sessions requires a recent sign-in.</p>
        <Link className="inline-block underline underline-offset-4" href="/login?callbackUrl=%2Fsettings%2Fsessions">
          Sign in
        </Link>
      </div>
    );
  }

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
