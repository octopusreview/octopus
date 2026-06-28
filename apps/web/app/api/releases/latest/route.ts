import { headers, cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { compareSemver, getCachedOrFreshRelease } from "@/lib/releases";

/**
 * GET /api/releases/latest
 *
 * Returns the cached latest release plus a comparison against the running
 * build's version. Used by the self-hosted Updates page.
 *
 * Auth: signed-in admins/owners of the active org only. The release tag
 * itself is public on GitHub, but the *comparison against your installed
 * version* leaks info about what you're running. Gating to admins keeps
 * that info inside the operator team where it belongs.
 *
 * Cache lives in SystemConfig.latestRelease. On a miss or stale read we
 * fetch synchronously through `getCachedOrFreshRelease` and write through,
 * so the page works with no background job. The fetch + cache logic lives in
 * `apps/web/lib/releases.ts`, importable from a future daily warm-keeper
 * worker without pulling Next.js runtime into worker context.
 */
export async function GET() {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cookieStore = await cookies();
  const currentOrgId = cookieStore.get("current_org_id")?.value;
  if (!currentOrgId) {
    return Response.json({ error: "No active org" }, { status: 400 });
  }

  const member = await prisma.organizationMember.findFirst({
    where: { userId: session.user.id, organizationId: currentOrgId, deletedAt: null },
    select: { role: true },
  });
  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return Response.json({ error: "Admin role required" }, { status: 403 });
  }

  const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
  const cached = await getCachedOrFreshRelease();

  if (!cached) {
    return Response.json({
      currentVersion,
      latestVersion: null,
      isUpToDate: false,
      releaseUrl: null,
      releaseNotes: null,
      publishedAt: null,
      cachedAt: null,
      error: "Could not check for updates. Try again later.",
    });
  }

  const latestVersion = cached.tagName.replace(/^v/, "");
  let isUpToDate = false;
  try {
    isUpToDate = compareSemver(currentVersion, latestVersion) >= 0;
  } catch (e) {
    // Surface as not-up-to-date rather than crashing — the user sees the
    // "couldn't check" panel instead of a wrong answer.
    console.warn(
      "[releases] semver compare failed:",
      e instanceof Error ? e.message : String(e),
    );
  }

  return Response.json({
    currentVersion,
    latestVersion,
    isUpToDate,
    releaseUrl: cached.htmlUrl,
    releaseNotes: cached.body,
    publishedAt: cached.publishedAt,
    cachedAt: cached.fetchedAt,
  });
}
