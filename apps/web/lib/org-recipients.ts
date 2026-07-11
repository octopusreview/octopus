import { prisma } from "@octopus/db";

/**
 * Owner/admin member emails for an organization — the recipient set for
 * org-level operational email (event notifications, admin incident comms).
 * Excludes soft-deleted memberships; notification preferences do NOT apply
 * here (these are account-level operational messages, not per-event opt-ins).
 */
export async function getAdminRecipients(
  orgId: string,
): Promise<{ email: string; name: string }[]> {
  const members = await prisma.organizationMember.findMany({
    where: {
      organizationId: orgId,
      deletedAt: null,
      role: { in: ["owner", "admin"] },
    },
    select: {
      user: { select: { email: true, name: true } },
    },
  });

  return members
    .filter((m) => m.user.email)
    .map((m) => ({ email: m.user.email, name: m.user.name }));
}
