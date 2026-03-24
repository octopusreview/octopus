import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { headers, cookies } from "next/headers";
import { prisma } from "@octopus/db";

/** User submits a request to mark a package as safe */
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const cookieStore = await cookies();
  const currentOrgId = cookieStore.get("current_org_id")?.value;

  const member = await prisma.organizationMember.findFirst({
    where: {
      userId: session.user.id,
      ...(currentOrgId ? { organizationId: currentOrgId } : {}),
      deletedAt: null,
    },
    select: { organizationId: true },
  });

  if (!member) {
    return Response.json({ error: "No organization found" }, { status: 403 });
  }

  let body: { packageName: string; version?: string; reason: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { packageName, version, reason } = body;
  if (!packageName || !reason) {
    return Response.json({ error: "packageName and reason are required" }, { status: 400 });
  }

  // Check if already approved globally
  const existing = await prisma.safePackage.findUnique({
    where: { name: packageName },
  });
  if (existing) {
    return Response.json({ message: "Package is already in the safe list", alreadySafe: true });
  }

  // Check if there's already a pending request
  const pendingRequest = await prisma.safePackageRequest.findFirst({
    where: { name: packageName, status: "pending" },
  });
  if (pendingRequest) {
    return Response.json({ message: "A request for this package is already pending review", alreadyPending: true });
  }

  // Create request
  const request = await prisma.safePackageRequest.create({
    data: {
      name: packageName,
      version,
      reason,
      organizationId: member.organizationId,
      userId: session.user.id,
    },
  });

  return Response.json({ id: request.id, message: "Request submitted for admin review" });
}
