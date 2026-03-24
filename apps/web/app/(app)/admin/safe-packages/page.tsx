import { prisma } from "@octopus/db";
import { SafePackagesAdmin } from "./safe-packages-admin";

export default async function SafePackagesPage() {
  const [safePackages, pendingRequests] = await Promise.all([
    prisma.safePackage.findMany({
      orderBy: { name: "asc" },
    }),
    prisma.safePackageRequest.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      include: {
        user: { select: { name: true, email: true } },
        organization: { select: { name: true } },
      },
    }),
  ]);

  return (
    <SafePackagesAdmin
      safePackages={safePackages.map((p) => ({
        ...p,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      }))}
      pendingRequests={pendingRequests.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
        userName: r.user.name,
        userEmail: r.user.email,
        orgName: r.organization.name,
      }))}
    />
  );
}
