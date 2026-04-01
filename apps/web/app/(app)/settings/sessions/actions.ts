"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { writeAuditLog } from "@/lib/audit";

export async function revokeSessionAction(formData: FormData) {
  const token = formData.get("token") as string;
  if (!token) return { error: "Token is required" };

  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session) return { error: "Unauthorized" };

  // Prevent revoking current session from here
  if (session.session.token === token) {
    return { error: "Cannot revoke your current session. Use sign out instead." };
  }

  const result = await auth.api.revokeSession({
    headers: reqHeaders,
    body: { token },
  });

  if (result?.status) {
    await writeAuditLog({
      action: "auth.session_revoked",
      category: "auth",
      actorId: session.user.id,
      actorEmail: session.user.email,
      targetType: "session",
      metadata: { revokedToken: token.slice(0, 8) + "..." },
    });
    revalidatePath("/settings/sessions");
    return { success: true };
  }

  revalidatePath("/settings/sessions");
  return { success: false, error: "Failed to revoke session" };
}

export async function revokeOtherSessionsAction() {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session) return { error: "Unauthorized" };

  const result = await auth.api.revokeOtherSessions({
    headers: reqHeaders,
  });

  if (result.status) {
    await writeAuditLog({
      action: "auth.other_sessions_revoked",
      category: "auth",
      actorId: session.user.id,
      actorEmail: session.user.email,
      targetType: "session",
    });
  }

  revalidatePath("/settings/sessions");
  return { success: result.status };
}
