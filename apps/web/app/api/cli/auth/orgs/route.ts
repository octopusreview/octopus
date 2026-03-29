import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { createOrgForUser } from "@/app/(app)/complete-profile/actions";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let memberships = await prisma.organizationMember.findMany({
    where: {
      userId: session.user.id,
      deletedAt: null,
      organization: { deletedAt: null, bannedAt: null },
    },
    select: {
      organization: {
        select: { id: true, name: true, slug: true },
      },
    },
  });

  // If user has no organization, create one automatically
  if (memberships.length === 0) {
    try {
      const userName = session.user.name || session.user.email?.split("@")[0] || "User";
      await createOrgForUser(session.user.id, userName);
    } catch {
      // Ignore — likely a concurrent request already created the org
    }

    memberships = await prisma.organizationMember.findMany({
      where: {
        userId: session.user.id,
        deletedAt: null,
        organization: { deletedAt: null, bannedAt: null },
      },
      select: {
        organization: {
          select: { id: true, name: true, slug: true },
        },
      },
    });
  }

  const organizations = memberships.map((m) => m.organization);

  return Response.json({ organizations });
}
