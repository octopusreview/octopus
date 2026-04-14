"use server";

import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { toBaseSlug, randomSlugSuffix } from "@/lib/slug";
import { canUserCreateOrg, isFirstOrgForUser, MAX_OWNED_ORGS_PER_USER } from "@/lib/org-limits";

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

/**
 * Creates an organization for a user. Pure DB operation — no cookie setting.
 * Safe to call from Server Components (layout) and Server Actions.
 */
export async function createOrgForUser(userId: string, userName: string) {
  const allowed = await canUserCreateOrg(userId);
  if (!allowed) {
    throw new Error(`Organization limit reached (max ${MAX_OWNED_ORGS_PER_USER}).`);
  }

  const firstName = userName.split(" ")[0];
  const orgName = `${firstName}'s Organization`;
  const baseSlug = toBaseSlug(orgName);

  // Generate unique slug with random suffix (checks all orgs including soft-deleted)
  let slug = `${baseSlug}-${randomSlugSuffix()}`;
  for (let i = 0; i < 10; i++) {
    const existing = await prisma.organization.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!existing) break;
    slug = `${baseSlug}-${randomSlugSuffix()}`;
  }

  const firstOrg = await isFirstOrgForUser(userId);

  const org = await prisma.organization.create({
    data: {
      name: orgName,
      slug,
      members: {
        create: {
          userId,
          role: "owner",
        },
      },
      ...(firstOrg && {
        creditTransactions: {
          create: {
            amount: 150,
            type: "free_credit",
            description: "Welcome bonus — $150 free credits",
            balanceAfter: 150,
          },
        },
      }),
    },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { onboardingCompleted: true },
  });

  return org;
}
