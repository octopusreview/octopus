import type { Prisma } from "@octopus/db";

const baseWhere: Prisma.UserWhereInput = {
  bannedAt: null,
};

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export function buildAudienceWhere(audience: string): Prisma.UserWhereInput {
  switch (audience) {
    case "all":
      return { ...baseWhere };

    case "inactive-7":
      return {
        ...baseWhere,
        sessions: { none: { createdAt: { gte: daysAgo(7) } } },
      };

    case "inactive-15":
      return {
        ...baseWhere,
        sessions: { none: { createdAt: { gte: daysAgo(15) } } },
      };

    case "inactive-30":
      return {
        ...baseWhere,
        sessions: { none: { createdAt: { gte: daysAgo(30) } } },
      };

    case "new-7":
      return { ...baseWhere, createdAt: { gte: daysAgo(7) } };

    case "new-15":
      return { ...baseWhere, createdAt: { gte: daysAgo(15) } };

    case "new-30":
      return { ...baseWhere, createdAt: { gte: daysAgo(30) } };

    case "no-org":
      return {
        ...baseWhere,
        organizationMembers: { none: {} },
      };

    case "no-repo":
      return {
        ...baseWhere,
        organizationMembers: {
          every: {
            organization: {
              repositories: { none: {} },
            },
          },
        },
      };

    case "no-review":
      return {
        ...baseWhere,
        organizationMembers: {
          every: {
            organization: {
              repositories: {
                every: {
                  pullRequests: { none: {} },
                },
              },
            },
          },
        },
      };

    case "onboarding-incomplete":
      return {
        ...baseWhere,
        onboardingCompleted: false,
      };

    case "marketing-opted-in":
      return {
        ...baseWhere,
        marketingEmailsEnabled: true,
      };

    default:
      return { ...baseWhere };
  }
}
