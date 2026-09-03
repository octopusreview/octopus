import { authenticateApiToken } from "@/lib/api-auth";
import { prisma } from "@octopus/db";

export async function GET(request: Request) {
  const result = await authenticateApiToken(request);
  if (result instanceof Response) return result; // account-standing hold (403), pass through
  if (!result) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [memberCount, repoCount] = await Promise.all([
    prisma.organizationMember.count({
      where: { organizationId: result.org.id, deletedAt: null },
    }),
    prisma.repository.count({
      where: { organizationId: result.org.id, isActive: true },
    }),
  ]);

  return Response.json({
    user: {
      id: result.user.id,
      name: result.user.name,
      email: result.user.email,
    },
    organization: {
      id: result.org.id,
      name: result.org.name,
      slug: result.org.slug,
      memberCount,
      repoCount,
    },
  });
}
