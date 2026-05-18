import { headers, cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { compareSemver, getCachedOrFreshRelease } from "@/lib/releases";

/**
 * Self-hosted Updates page. Compares the running build's version with the
 * latest GitHub Release of octopusreview/octopus and renders an upgrade
 * snippet when out of date.
 *
 * Gated on NEXT_PUBLIC_OCTOPUS_SELF_HOSTED=true (the same flag the settings
 * nav reads to surface the menu entry) so hosted users don't see the page —
 * their version is whatever the platform deployed, no user upgrade needed.
 *
 * Calls `getCachedOrFreshRelease` directly rather than self-fetching the
 * sibling API route — SSR self-fetch is fragile under deployment edge cases
 * (host bound to wrong URL, internal vs public hostnames, request-context
 * loss) and the lib does the same work without the round-trip.
 */
export default async function UpdatesSettingsPage() {
  if (process.env.NEXT_PUBLIC_OCTOPUS_SELF_HOSTED !== "true") {
    notFound();
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const currentOrgId = cookieStore.get("current_org_id")?.value;
  const member = await prisma.organizationMember.findFirst({
    where: {
      userId: session.user.id,
      ...(currentOrgId ? { organizationId: currentOrgId } : {}),
      deletedAt: null,
    },
    select: { role: true },
  });
  if (!member) redirect("/dashboard");
  if (member.role !== "owner" && member.role !== "admin") redirect("/settings");

  // Treat `0.0.0` (the fallback) and missing/empty as "unknown" so we can
  // render a clear hint rather than a misleading "you're behind" panel that
  // would show whenever the build forgot to thread NEXT_PUBLIC_APP_VERSION.
  const rawVersion = process.env.NEXT_PUBLIC_APP_VERSION?.trim();
  const currentVersion = rawVersion && rawVersion !== "0.0.0" ? rawVersion : null;
  const cached = await getCachedOrFreshRelease();

  const latestVersion = cached?.tagName.replace(/^v/, "") ?? null;
  let isUpToDate = false;
  if (currentVersion && latestVersion) {
    try {
      isUpToDate = compareSemver(currentVersion, latestVersion) >= 0;
    } catch {
      // Treat parse failure as not-up-to-date so the user sees the
      // "couldn't check" panel rather than a misleading green check.
      isUpToDate = false;
    }
  }

  const data = cached
    ? {
        currentVersion,
        latestVersion,
        isUpToDate,
        releaseUrl: cached.htmlUrl,
        publishedAt: cached.publishedAt,
        cachedAt: cached.fetchedAt,
      }
    : null;

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Updates</h1>
        <p className="mt-1 text-sm text-[#888]">
          Compare your self-hosted Octopus version against the latest GitHub release.
        </p>
      </div>

      {!currentVersion ? (
        <Panel tone="warn">
          <p className="text-sm">Version unknown.</p>
          <p className="mt-1 text-xs text-[#888]">
            Set <code>NEXT_PUBLIC_APP_VERSION</code> as a build arg when building the
            Docker image so this page can compare against the latest release.
          </p>
        </Panel>
      ) : !data || !data.latestVersion ? (
        <Panel tone="warn">
          <p className="text-sm">Could not check for updates.</p>
          <p className="mt-1 text-xs text-[#888]">
            The daily release-check job hasn&apos;t run yet, or the GitHub API is
            unreachable. Try again later.
          </p>
        </Panel>
      ) : data.isUpToDate ? (
        <Panel tone="ok">
          <p className="text-sm">
            You&apos;re on the latest release.
            {" "}<span className="text-white font-medium">{data.currentVersion}</span>
            {" "}— <a className="text-cyan-400 underline" href={data.releaseUrl ?? "#"}>release notes</a>
          </p>
        </Panel>
      ) : (
        <Panel tone="warn">
          <p className="text-sm">
            New release available.
            {" "}<span className="text-white font-medium">{data.currentVersion}</span>
            {" "}→{" "}<span className="text-white font-medium">{data.latestVersion}</span>
          </p>
          <p className="mt-1 text-xs text-[#888]">
            Published {data.publishedAt ? new Date(data.publishedAt).toLocaleString() : "?"}.
            {" "}<a className="text-cyan-400 underline" href={data.releaseUrl ?? "#"}>Release notes</a>.
          </p>
          <pre className="mt-3 overflow-x-auto rounded bg-[#0a0a0a] p-3 text-xs text-[#ccc]">
{`docker compose pull
docker compose up -d
docker compose exec web bunx prisma migrate deploy`}
          </pre>
        </Panel>
      )}

      <div className="mt-6 text-xs text-[#666]">
        Cache refreshes daily via the <code>refresh-release-cache</code> pg-boss
        job. Last check: {data?.cachedAt ? new Date(data.cachedAt).toLocaleString() : "never"}.
      </div>
    </div>
  );
}

function Panel({ tone, children }: { tone: "ok" | "warn"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "border-green-900/50 bg-green-950/30 text-green-100"
      : "border-yellow-900/50 bg-yellow-950/30 text-yellow-100";
  return <div className={`rounded border p-4 ${cls}`}>{children}</div>;
}
