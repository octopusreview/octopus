"use server";

import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { createOrgForUser } from "@/lib/org-create";

export async function completeProfile(
  _prevState: { error?: string },
  formData: FormData,
): Promise<{ error?: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");

  const name = (formData.get("name") as string)?.trim();
  if (!name || name.length < 2) {
    return { error: "Name must be at least 2 characters." };
  }
  if (name.length > 100) {
    return { error: "Name must be at most 100 characters." };
  }
  if (/[<>"'`{}()\\\/;]/.test(name)) {
    return { error: "Name contains invalid characters." };
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { name },
  });

  const org = await createOrgForUser(session.user.id, name);

  // Server action can set cookies
  const cookieStore = await cookies();
  cookieStore.set("current_org_id", org.id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });

  redirect("/dashboard");
}
