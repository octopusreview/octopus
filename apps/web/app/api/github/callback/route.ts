import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@octopus/db";
import { listInstallationRepos } from "@/lib/github";
import { getRedis } from "@/lib/redis";
import { verifyInstallState, stateReplayKey } from "@/lib/github-install-state";

const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";

function errorRedirect(reason: string) {
  const url = new URL("/settings/integrations", baseUrl);
  url.searchParams.set("error", reason);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const installationId = request.nextUrl.searchParams.get("installation_id");
  const stateParam = request.nextUrl.searchParams.get("state");

  if (!stateParam) {
    return errorRedirect("missing_state");
  }

  const verified = verifyInstallState(stateParam);
  if (!verified.ok) {
    console.warn(`[github/callback] state verification failed: ${verified.reason}`);
    return errorRedirect(`invalid_state_${verified.reason}`);
  }
  const { uid, oid, rt, jti, exp } = verified.payload;

  const redis = getRedis();
  if (redis) {
    const ttlMs = Math.max(exp - Date.now(), 0) + 60_000;
    const set = await redis.set(stateReplayKey(jti), "1", "PX", ttlMs, "NX");
    if (set !== "OK") {
      console.warn(`[github/callback] state replay detected jti=${jti}`);
      return errorRedirect("replay_detected");
    }
  } else {
    console.warn(
      "[github/callback] Redis unavailable — replay protection is disabled for this request",
    );
  }

  if (!installationId) {
    return NextResponse.redirect(new URL(rt, baseUrl));
  }

  const membership = await prisma.organizationMember.findFirst({
    where: {
      userId: uid,
      organizationId: oid,
      deletedAt: null,
    },
    select: { organizationId: true },
  });

  if (!membership) {
    return errorRedirect("not_a_member");
  }

  const installationIdNum = parseInt(installationId, 10);
  if (!Number.isFinite(installationIdNum) || installationIdNum <= 0) {
    return errorRedirect("invalid_installation_id");
  }

  const existingBinding = await prisma.organization.findUnique({
    where: { githubInstallationId: installationIdNum },
    select: { id: true },
  });

  if (existingBinding && existingBinding.id !== membership.organizationId) {
    console.warn(
      `[github/callback] installation already bound: user=${uid} installation=${installationIdNum} existingOrg=${existingBinding.id} requestedOrg=${membership.organizationId}`,
    );
    return errorRedirect("installation_already_bound");
  }

  if (!existingBinding) {
    await prisma.organization.update({
      where: { id: membership.organizationId },
      data: { githubInstallationId: installationIdNum },
    });
  }

  try {
    const ghRepos = await listInstallationRepos(installationIdNum);
    console.log(
      `[github/callback] listInstallationRepos returned ${ghRepos.length} repos for installation=${installationIdNum}`,
    );
    for (const repo of ghRepos) {
      await prisma.repository.upsert({
        where: {
          provider_externalId_organizationId: {
            provider: "github",
            externalId: String(repo.id),
            organizationId: membership.organizationId,
          },
        },
        create: {
          name: repo.name,
          fullName: repo.full_name,
          externalId: String(repo.id),
          defaultBranch: repo.default_branch,
          provider: "github",
          installationId: installationIdNum,
          organizationId: membership.organizationId,
        },
        update: {
          name: repo.name,
          fullName: repo.full_name,
          defaultBranch: repo.default_branch,
          installationId: installationIdNum,
          isActive: true,
          organizationId: membership.organizationId,
        },
      });
    }
    console.log(
      `[github/callback] synced ${ghRepos.length} repos to org=${membership.organizationId}`,
    );
  } catch (err) {
    console.error("[github/callback] repo sync error:", err);
  }

  revalidatePath("/", "layout");
  revalidatePath("/");
  const redirectTo = rt.startsWith("/") && !rt.startsWith("//") ? rt : "/settings/integrations";
  return NextResponse.redirect(new URL(redirectTo, baseUrl));
}
