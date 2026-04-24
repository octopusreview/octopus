import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { GitHubIntegrationCard } from "./github-integration-card";
import { SlackIntegrationCard } from "./slack-integration-card";
import { BitbucketIntegrationCard } from "./bitbucket-integration-card";
import { BitbucketDebugBanner } from "./bitbucket-debug-banner";
import { LinearIntegrationCard } from "./linear-integration-card";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const bbDebug = typeof params.bb_debug === "string" ? params.bb_debug : null;
  const rawError = typeof params.error === "string" ? params.error : null;
  const ALLOWED_GITHUB_ERRORS = [
    "installation_already_bound",
    "invalid_installation_id",
    "missing_state",
    "invalid_state_bad_signature",
    "invalid_state_expired",
    "invalid_state_malformed",
    "replay_detected",
    "not_a_member",
  ] as const;
  const githubError =
    rawError && (ALLOWED_GITHUB_ERRORS as readonly string[]).includes(rawError)
      ? (rawError as (typeof ALLOWED_GITHUB_ERRORS)[number])
      : null;
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");

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

  if (!member) redirect("/dashboard");

  const orgId = member.organizationId;

  const [slackIntegration, bitbucketIntegration, githubData, , linearIntegration] = await Promise.all([
    prisma.slackIntegration.findUnique({
      where: { organizationId: orgId },
      select: {
        teamName: true,
        channelId: true,
        channelName: true,
        eventConfigs: {
          select: { eventType: true, enabled: true },
        },
      },
    }),
    prisma.bitbucketIntegration.findUnique({
      where: { organizationId: orgId },
      select: {
        workspaceName: true,
        workspaceSlug: true,
      },
    }),
    prisma.organization
      .findUnique({
        where: { id: orgId },
        select: { githubInstallationId: true },
      })
      .then(async (org) => {
        if (!org?.githubInstallationId) return null;
        const repoCount = await prisma.repository.count({
          where: { organizationId: orgId, provider: "github", isActive: true },
        });
        return { repoCount };
      }),
    prisma.collabIntegration.findUnique({
      where: { organizationId: orgId },
      select: {
        baseUrl: true,
        isActive: true,
        workspaceName: true,
      },
    }),
    prisma.linearIntegration
      .findUnique({ where: { organizationId: orgId }, select: { workspaceName: true } })
      .catch(() => null),
  ]);

  const appSlug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG ?? null;

  return (
    <div className="space-y-6">
      {bbDebug && <BitbucketDebugBanner debugJson={bbDebug} />}
      <GitHubIntegrationCard
        data={githubData}
        appSlug={appSlug}
        error={githubError}
      />
      <BitbucketIntegrationCard data={bitbucketIntegration} />
      <SlackIntegrationCard data={slackIntegration} />
      <LinearIntegrationCard data={linearIntegration} />
    </div>
  );
}
