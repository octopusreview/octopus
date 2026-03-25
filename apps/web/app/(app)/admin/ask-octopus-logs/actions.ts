"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { prisma } from "@octopus/db";
import { revalidatePath } from "next/cache";

export async function toggleFlag(sessionId: string, flagged: boolean, reason?: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAdminEmail(session.user.email)) {
    return { error: "Unauthorized" };
  }

  await prisma.askOctopusSession.update({
    where: { id: sessionId },
    data: {
      flagged,
      flagReason: flagged ? (reason || null) : null,
    },
  });

  revalidatePath("/admin/ask-octopus-logs");
  return { success: true };
}
