import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { GitHubIntegrationCard } from "./github-integration-card";
import { SlackIntegrationCard } from "./slack-integration-card";
import { BitbucketIntegrationCard } from "./bitbucket-integration-card";
import { BitbucketDebugBanner } from "./bitbucket-debug-banner";
import { GitlabIntegrationCard } from "./gitlab-integration-card";
import { LinearIntegrationCard } from "./linear-integration-card";
import { JiraIntegrationCard } from "./jira-integration-card";
import { IntegrationOAuthErrorBanner } from "./integration-oauth-error-banner";
import { getGithubAppConfig } from "@/lib/github-app-config";
import { isSelfHosted } from "@/lib/self-hosted";

const ALLOWED_GITHUB_ERRORS = [
  "installation_already_bound",
  "invalid_installation_id",
  "missing_state",
  "invalid_state_bad_signature",
  "invalid_state_expired",
  "invalid_state_malformed",
  "replay_detected",
  "state_store_unavailable",
  "session_required",
  "state_user_mismatch",
  "state_browser_mismatch",
  "github_app_not_configured",
  "github_verification_not_configured",
  "github_authorization_denied",
  "github_authorization_failed",
  "installation_not_accessible",
  "not_a_member",
  "manifest_forbidden",
  "manifest_already_configured",
  "manifest_bad_org",
  "manifest_expired",
  "manifest_failed",
] as const;

type GitHubErrorCode = (typeof ALLOWED_GITHUB_ERRORS)[number];

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const bbDebug = typeof params.bb_debug === "string" ? params.bb_debug : null;
  const glDebug = typeof params.gl_debug === "string" ? params.gl_debug : null;
  const rawError = typeof params.error === "string" ? params.error : null;
  const githubError: GitHubErrorCode | null =
    rawError && (ALLOWED_GITHUB_ERRORS as readonly string[]).includes(rawError)
      ? (rawError as GitHubErrorCode)
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

  const [
    slackIntegration,
    bitbucketIntegration,
    gitlabIntegration,
    githubData,
    ,
    linearIntegration,
    jiraIntegration,
  ] = await Promise.all([
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
    prisma.gitlabIntegration.findUnique({
      where: { organizationId: orgId },
      select: {
        namespaceName: true,
        namespacePath: true,
        gitlabHost: true,
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
    prisma.jiraIntegration
      .findUnique({ where: { organizationId: orgId }, select: { siteName: true } })
      .catch(() => null),
  ]);

  // DB-first so the card flips to "Install" after a manifest-created app whose
  // NEXT_PUBLIC_* slug isn't baked into this build.
  const appSlug = (await getGithubAppConfig())?.slug ?? null;
  const selfHosted = isSelfHosted();

  return (
    <div className="space-y-6">
      <IntegrationOAuthErrorBanner error={rawError} />
      {bbDebug && <BitbucketDebugBanner debugJson={bbDebug} />}
      {glDebug && <BitbucketDebugBanner debugJson={glDebug} title="GitLab Connect Debug" />}
      <GitHubIntegrationCard
        data={githubData}
        appSlug={appSlug}
        isSelfHosted={selfHosted}
        error={githubError}
      />
      <BitbucketIntegrationCard data={bitbucketIntegration} />
      <GitlabIntegrationCard
        data={gitlabIntegration}
        redirectUri={process.env.GITLAB_REDIRECT_URI ?? null}
      />
      <SlackIntegrationCard data={slackIntegration} />
      <LinearIntegrationCard data={linearIntegration} />
      <JiraIntegrationCard data={jiraIntegration} />
    </div>
  );
}
