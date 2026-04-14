import { prisma } from "@octopus/db";

export const MAX_OWNED_ORGS_PER_USER = 3;

export async function canUserCreateOrg(userId: string): Promise<boolean> {
  const count = await prisma.organizationMember.count({
    where: {
      userId,
      role: "owner",
      deletedAt: null,
      organization: { deletedAt: null },
    },
  });
  return count < MAX_OWNED_ORGS_PER_USER;
}

export async function isFirstOrgForUser(userId: string): Promise<boolean> {
  const count = await prisma.organizationMember.count({
    where: {
      userId,
      role: "owner",
      organization: { deletedAt: null },
    },
  });
  return count === 0;
}
