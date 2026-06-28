import { NextRequest, NextResponse } from "next/server";
import { authenticateApiToken } from "@/lib/api-auth";
import { prisma } from "@octopus/db";

/**
 * GET /api/cli/repos/by-remote?url=<git-remote-url>
 *
 * Resolves a git remote URL (eg. `git@github.com:octopusreview/octopus.git`
 * or `https://github.com/octopusreview/octopus`) to the matching
 * Repository row for the authenticated org. Used by `octp review` so the
 * CLI can find the right `repoId` without making the user pick from a
 * picker.
 *
 * Returns 200 with `{ id, fullName, provider }` on match, 404 otherwise.
 * Returning 404 (not a guessed fallback) keeps the caller's UX honest:
 * "this repo isn't connected to Octopus, register it first."
 *
 * Match strategy: parse the input into a `provider` + `owner/repo` pair and
 * match them against Repository.provider and Repository.fullName separately.
 * We deliberately ignore SSH-vs-HTTPS variation so the same physical repo
 * cloned via different protocols resolves to the same Octopus row.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiToken(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "url query param required" }, { status: 400 });
  }

  const normalised = normaliseRemoteUrl(url);
  if (!normalised) {
    return NextResponse.json(
      { error: "Could not parse remote URL" },
      { status: 400 },
    );
  }

  const repo = await prisma.repository.findFirst({
    where: {
      organizationId: auth.org.id,
      fullName: normalised.fullName,
      provider: normalised.provider,
      isActive: true,
    },
    select: { id: true, fullName: true, provider: true },
  });

  if (!repo) {
    return NextResponse.json(
      {
        error: `No active repo matches ${normalised.provider}:${normalised.fullName} in this org`,
      },
      { status: 404 },
    );
  }

  return NextResponse.json(repo);
}

/**
 * Normalise the assortment of URL shapes git accepts into a stable
 * `{ provider, fullName }` pair. Examples:
 *   git@github.com:foo/bar.git           → github, foo/bar
 *   https://github.com/foo/bar.git       → github, foo/bar
 *   https://github.com/foo/bar           → github, foo/bar
 *   ssh://git@bitbucket.org/foo/bar.git  → bitbucket, foo/bar
 *   git@gitlab.com:foo/bar/baz.git       → gitlab, foo/bar/baz  (subgroup OK)
 */
export function normaliseRemoteUrl(
  raw: string,
): { provider: "github" | "gitlab" | "bitbucket"; fullName: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // scp-style: git@host:path/repo[.git]
  const scp = /^(?:\w+@)?([^:/]+):([^/].*?)(?:\.git)?\/?$/.exec(trimmed);
  let host: string | null = null;
  let path: string | null = null;
  if (scp && !trimmed.includes("://")) {
    host = scp[1];
    path = scp[2];
  } else {
    try {
      const u = new URL(trimmed);
      host = u.hostname;
      path = u.pathname.replace(/^\//, "").replace(/\.git\/?$/, "");
    } catch {
      return null;
    }
  }
  if (!host || !path) return null;
  // Strip any trailing slashes that survived (browser-copied URLs like
  // https://github.com/foo/bar/ , redundant slashes) so they resolve to the
  // same Repository row as the canonical foo/bar.
  path = path.replace(/\/+$/, "");
  if (!path) return null;
  const provider = providerFromHost(host);
  if (!provider) return null;

  return { provider, fullName: path };
}

function providerFromHost(host: string): "github" | "gitlab" | "bitbucket" | null {
  const h = host.toLowerCase();
  if (h.includes("github")) return "github";
  if (h.includes("gitlab")) return "gitlab";
  if (h.includes("bitbucket")) return "bitbucket";
  return null;
}
