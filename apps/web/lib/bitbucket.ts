import { prisma } from "@octopus/db";

const BITBUCKET_API = "https://api.bitbucket.org/2.0";

// ── Token Management ──

async function getIntegration(organizationId: string) {
  const integration = await prisma.bitbucketIntegration.findUnique({
    where: { organizationId },
  });
  if (!integration) {
    throw new Error("No Bitbucket integration found for this organization");
  }
  return integration;
}

export async function refreshAccessToken(
  integrationId: string,
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
  const clientId = process.env.BITBUCKET_CLIENT_ID;
  const clientSecret = process.env.BITBUCKET_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing BITBUCKET_CLIENT_ID or BITBUCKET_CLIENT_SECRET environment variables");
  }

  const res = await fetch("https://bitbucket.org/site/oauth2/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Failed to refresh Bitbucket token: ${res.status} ${errBody}`);
  }

  const data = await res.json();
  const newAccessToken = data.access_token as string | undefined;
  const expiresIn = data.expires_in as number | undefined;

  if (!newAccessToken || !expiresIn) {
    throw new Error("Invalid token refresh response: missing access_token or expires_in");
  }

  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  await prisma.bitbucketIntegration.update({
    where: { id: integrationId },
    data: {
      accessToken: newAccessToken,
      refreshToken: (data.refresh_token as string) ?? refreshToken,
      tokenExpiresAt: expiresAt,
    },
  });

  return {
    accessToken: newAccessToken,
    refreshToken: (data.refresh_token as string) ?? refreshToken,
    expiresAt,
  };
}

export async function getAccessToken(organizationId: string): Promise<string> {
  const integration = await getIntegration(organizationId);

  // Refresh if token expires within 5 minutes
  const bufferMs = 5 * 60 * 1000;
  if (integration.tokenExpiresAt.getTime() - Date.now() < bufferMs) {
    console.log(`[bitbucket] Token expiring soon for org ${organizationId}, refreshing...`);
    const refreshed = await refreshAccessToken(integration.id, integration.refreshToken);
    return refreshed.accessToken;
  }

  return integration.accessToken;
}

// ── Repository Operations ──

export interface BitbucketRepo {
  uuid: string;
  name: string;
  full_name: string;
  is_private: boolean;
  mainbranch?: { name: string };
  links: { html: { href: string } };
}

export async function listWorkspaceRepos(
  organizationId: string,
  workspaceSlug: string,
): Promise<BitbucketRepo[]> {
  const token = await getAccessToken(organizationId);
  const repos: BitbucketRepo[] = [];
  let url: string | null = `${BITBUCKET_API}/repositories/${workspaceSlug}?pagelen=100`;

  while (url) {
    const pageRes: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!pageRes.ok) {
      throw new Error(`Failed to list Bitbucket repos: ${pageRes.status}`);
    }

    const pageData = await pageRes.json();
    repos.push(...pageData.values);
    url = pageData.next ?? null;
  }

  return repos;
}

// ── Pull Request Operations ──

export interface PullRequestDetails {
  number: number;
  title: string;
  url: string;
  author: string;
  headSha: string;
}

export async function getPullRequestDetails(
  organizationId: string,
  workspace: string,
  repoSlug: string,
  prId: number,
): Promise<PullRequestDetails> {
  const token = await getAccessToken(organizationId);
  const res = await fetch(
    `${BITBUCKET_API}/repositories/${workspace}/${repoSlug}/pullrequests/${prId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) {
    throw new Error(`Failed to get Bitbucket PR details: ${res.status}`);
  }

  const data = await res.json();
  return {
    number: data.id,
    title: data.title,
    url: data.links?.html?.href ?? "",
    author: data.author?.display_name ?? data.author?.nickname ?? "unknown",
    headSha: data.source?.commit?.hash ?? "",
  };
}

export async function getPullRequestDiff(
  organizationId: string,
  workspace: string,
  repoSlug: string,
  prId: number,
): Promise<string> {
  const token = await getAccessToken(organizationId);
  const res = await fetch(
    `${BITBUCKET_API}/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/diff`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) {
    throw new Error(`Failed to get Bitbucket PR diff: ${res.status}`);
  }

  const diff = await res.text();
  return diff.length > 30_000
    ? diff.slice(0, 30_000) + "\n\n[... diff truncated at 30,000 chars]"
    : diff;
}

export async function createPullRequestComment(
  organizationId: string,
  workspace: string,
  repoSlug: string,
  prId: number,
  body: string,
): Promise<number> {
  const token = await getAccessToken(organizationId);
  const res = await fetch(
    `${BITBUCKET_API}/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/comments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: { raw: body } }),
    },
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Failed to create Bitbucket PR comment: ${res.status} ${errBody}`);
  }

  const data = await res.json();
  return data.id as number;
}

export async function updatePullRequestComment(
  organizationId: string,
  workspace: string,
  repoSlug: string,
  prId: number,
  commentId: number,
  body: string,
): Promise<void> {
  const token = await getAccessToken(organizationId);
  const res = await fetch(
    `${BITBUCKET_API}/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/comments/${commentId}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: { raw: body } }),
    },
  );

  if (!res.ok) {
    throw new Error(`Failed to update Bitbucket PR comment: ${res.status}`);
  }
}

export async function createInlineComment(
  organizationId: string,
  workspace: string,
  repoSlug: string,
  prId: number,
  filePath: string,
  line: number,
  body: string,
): Promise<number> {
  const token = await getAccessToken(organizationId);
  const res = await fetch(
    `${BITBUCKET_API}/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/comments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: { raw: body },
        inline: {
          path: filePath,
          to: line,
        },
      }),
    },
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Failed to create Bitbucket inline comment: ${res.status} ${errBody}`);
  }

  const data = await res.json();
  return data.id as number;
}

// ── Repository Tree & Content ──

export async function getRepositoryTree(
  organizationId: string,
  workspace: string,
  repoSlug: string,
  branch: string,
): Promise<string[]> {
  const token = await getAccessToken(organizationId);
  const paths: string[] = [];
  const visited = new Set<string>();
  const CONCURRENCY = 5;
  const TIMEOUT_MS = 15_000;
  const MAX_RETRIES = 3;

  async function fetchWithRetry(url: string): Promise<Response | null> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });

        if (res.status === 429) {
          const retryAfter = res.headers.get("retry-after");
          const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 2000 * (attempt + 1);
          console.warn(`[bitbucket] Rate limited, waiting ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }

        return res;
      } catch (err) {
        if (attempt === MAX_RETRIES - 1) {
          console.warn(`[bitbucket] Failed after ${MAX_RETRIES} attempts: ${url}`, err);
          return null;
        }
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }

  async function fetchDir(dirUrl: string): Promise<string[]> {
    if (visited.has(dirUrl)) return [];
    visited.add(dirUrl);

    const subDirs: string[] = [];

    const res = await fetchWithRetry(dirUrl);
    if (!res || !res.ok) {
      if (res) console.warn(`[bitbucket] Failed to fetch ${dirUrl}: ${res.status}`);
      return [];
    }

    const data = await res.json();
    for (const item of data.values ?? []) {
      if (item.type === "commit_file") {
        paths.push(item.path);
      } else if (item.type === "commit_directory") {
        subDirs.push(
          `${BITBUCKET_API}/repositories/${workspace}/${repoSlug}/src/${encodeURIComponent(branch)}/${item.path}/?pagelen=100`,
        );
      }
    }

    if (data.next) {
      subDirs.push(data.next);
    }

    return subDirs;
  }

  // BFS with bounded concurrency
  let queue: string[] = [
    `${BITBUCKET_API}/repositories/${workspace}/${repoSlug}/src/${encodeURIComponent(branch)}/?pagelen=100`,
  ];

  while (queue.length > 0) {
    const batch = queue.splice(0, CONCURRENCY);
    const results = await Promise.all(batch.map((url) => fetchDir(url)));
    queue.push(...results.flat());
  }

  return paths;
}

export async function getFileContent(
  organizationId: string,
  workspace: string,
  repoSlug: string,
  branch: string,
  filePath: string,
): Promise<string> {
  const token = await getAccessToken(organizationId);
  const res = await fetch(
    `${BITBUCKET_API}/repositories/${workspace}/${repoSlug}/src/${encodeURIComponent(branch)}/${filePath}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/octet-stream",
      },
    },
  );

  if (!res.ok) {
    throw new Error(`Failed to get Bitbucket file content: ${res.status}`);
  }

  return res.text();
}

// ── Webhooks ──

export async function createWebhook(
  organizationId: string,
  workspaceSlug: string,
  callbackUrl: string,
  secret: string,
): Promise<string> {
  const token = await getAccessToken(organizationId);
  const res = await fetch(
    `${BITBUCKET_API}/workspaces/${workspaceSlug}/hooks`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        description: "Octopus Review",
        url: callbackUrl,
        active: true,
        secret,
        events: [
          "pullrequest:created",
          "pullrequest:updated",
          "pullrequest:comment_created",
        ],
      }),
    },
  );

  if (!res.ok) {
    const errBody = await res.text();
    console.error(`[bitbucket] Failed to create webhook: ${res.status} ${errBody}`);
    // Non-fatal — webhook creation is best-effort
    return "";
  }

  const data = await res.json();
  return data.uuid as string;
}

export async function deleteWebhook(
  organizationId: string,
  workspaceSlug: string,
  hookUuid: string,
): Promise<void> {
  const token = await getAccessToken(organizationId);
  const res = await fetch(
    `${BITBUCKET_API}/workspaces/${workspaceSlug}/hooks/${hookUuid}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (!res.ok) {
    console.error(`[bitbucket] Failed to delete webhook: ${res.status}`);
  }
}
