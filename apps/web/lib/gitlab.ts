import { prisma } from "@octopus/db";
import { decryptString, encryptString, decryptStringMaybeLegacy } from "@/lib/crypto";

// ── Token Management ──

async function getIntegration(organizationId: string) {
  const integration = await prisma.gitlabIntegration.findUnique({
    where: { organizationId },
  });
  if (!integration) {
    throw new Error("No GitLab integration found for this organization");
  }
  return integration;
}

function apiBase(host: string): string {
  return `${host.replace(/\/+$/, "")}/api/v4`;
}

/**
 * Resolve OAuth app credentials. Per-integration creds (used by self-hosted
 * orgs) take precedence; fall back to env vars for gitlab.com.
 */
export function resolveOAuthCreds(integration: {
  oauthClientId: string | null;
  oauthClientSecretEnc: string | null;
}): { clientId: string; clientSecret: string } {
  if (integration.oauthClientId && integration.oauthClientSecretEnc) {
    return {
      clientId: integration.oauthClientId,
      clientSecret: decryptString(integration.oauthClientSecretEnc),
    };
  }
  const clientId = process.env.GITLAB_CLIENT_ID;
  const clientSecret = process.env.GITLAB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "No GitLab OAuth credentials configured. Set GITLAB_CLIENT_ID/GITLAB_CLIENT_SECRET env vars or attach per-integration credentials.",
    );
  }
  return { clientId, clientSecret };
}

export async function refreshAccessToken(
  integrationId: string,
  refreshToken: string,
  host: string,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
  const integration = await prisma.gitlabIntegration.findUnique({
    where: { id: integrationId },
    select: { oauthClientId: true, oauthClientSecretEnc: true },
  });
  if (!integration) {
    throw new Error(`GitLab integration ${integrationId} not found`);
  }
  const { clientId, clientSecret } = resolveOAuthCreds(integration);

  const res = await fetch(`${host.replace(/\/+$/, "")}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Failed to refresh GitLab token: ${res.status} ${errBody}`);
  }

  const data = await res.json();
  const newAccessToken = data.access_token as string | undefined;
  const expiresIn = data.expires_in as number | undefined;

  if (!newAccessToken || !expiresIn) {
    throw new Error("Invalid token refresh response: missing access_token or expires_in");
  }

  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  const newRefresh = (data.refresh_token as string) ?? refreshToken;

  await prisma.gitlabIntegration.update({
    where: { id: integrationId },
    data: {
      accessToken: encryptString(newAccessToken),
      refreshToken: encryptString(newRefresh),
      tokenExpiresAt: expiresAt,
    },
  });

  return {
    accessToken: newAccessToken,
    refreshToken: newRefresh,
    expiresAt,
  };
}

export async function getAccessToken(organizationId: string): Promise<string> {
  const integration = await getIntegration(organizationId);

  // Refresh if token expires within 5 minutes
  const bufferMs = 5 * 60 * 1000;
  if (integration.tokenExpiresAt.getTime() - Date.now() < bufferMs) {
    console.log(`[gitlab] Token expiring soon for org ${organizationId}, refreshing...`);
    const refreshed = await refreshAccessToken(
      integration.id,
      decryptStringMaybeLegacy(integration.refreshToken),
      integration.gitlabHost,
    );
    return refreshed.accessToken;
  }

  return decryptStringMaybeLegacy(integration.accessToken);
}

async function getHost(organizationId: string): Promise<string> {
  const integration = await getIntegration(organizationId);
  return integration.gitlabHost;
}

/** Public host (no trailing slash) used to build git clone URLs. */
export async function getCloneHost(organizationId: string): Promise<string> {
  const host = await getHost(organizationId);
  return host.replace(/\/+$/, "");
}

// ── Project Operations ──

export interface GitlabProject {
  id: number;
  name: string;
  path_with_namespace: string;
  default_branch: string | null;
  visibility: string;
  web_url: string;
}

export async function listNamespaceProjects(
  organizationId: string,
  namespacePath: string,
): Promise<GitlabProject[]> {
  const token = await getAccessToken(organizationId);
  const host = await getHost(organizationId);
  const projects: GitlabProject[] = [];
  // groups endpoint covers groups & subgroups; if user enters a username, fall back to /users
  let url: string | null =
    `${apiBase(host)}/groups/${encodeURIComponent(namespacePath)}/projects?per_page=100&include_subgroups=true&archived=false`;

  let isFirst = true;
  while (url) {
    const pageRes: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Fallback to /users on first 404 — namespace might be a personal user, not a group
    if (isFirst && pageRes.status === 404) {
      url = `${apiBase(host)}/users/${encodeURIComponent(namespacePath)}/projects?per_page=100&archived=false`;
      const userRes: Response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!userRes.ok) {
        throw new Error(`Failed to list GitLab projects: ${userRes.status}`);
      }
      const userData = await userRes.json();
      projects.push(...(userData as GitlabProject[]));
      url = parseNextLink(userRes.headers.get("link"));
      isFirst = false;
      continue;
    }

    if (!pageRes.ok) {
      throw new Error(`Failed to list GitLab projects: ${pageRes.status}`);
    }

    const pageData = (await pageRes.json()) as GitlabProject[];
    projects.push(...pageData);
    url = parseNextLink(pageRes.headers.get("link"));
    isFirst = false;
  }

  return projects;
}

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.split(",").find((s) => /rel="next"/.test(s));
  if (!match) return null;
  const urlMatch = match.match(/<([^>]+)>/);
  return urlMatch?.[1] ?? null;
}

// ── Merge Request Operations ──

export interface MergeRequestDetails {
  number: number;
  title: string;
  url: string;
  author: string;
  headSha: string;
}

export async function getPullRequestDetails(
  organizationId: string,
  projectPath: string,
  mrIid: number,
): Promise<MergeRequestDetails> {
  const token = await getAccessToken(organizationId);
  const host = await getHost(organizationId);
  const res = await fetch(
    `${apiBase(host)}/projects/${encodeURIComponent(projectPath)}/merge_requests/${mrIid}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) {
    throw new Error(`Failed to get GitLab MR details: ${res.status}`);
  }

  const data = await res.json();
  return {
    number: data.iid,
    title: data.title,
    url: data.web_url ?? "",
    author: data.author?.name ?? data.author?.username ?? "unknown",
    headSha: data.sha ?? data.diff_refs?.head_sha ?? "",
  };
}

export async function getPullRequestDiff(
  organizationId: string,
  projectPath: string,
  mrIid: number,
): Promise<string> {
  const token = await getAccessToken(organizationId);
  const host = await getHost(organizationId);
  // GitLab returns diffs as JSON entries — synthesise a unified diff.
  const res = await fetch(
    `${apiBase(host)}/projects/${encodeURIComponent(projectPath)}/merge_requests/${mrIid}/diffs?per_page=100`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) {
    throw new Error(`Failed to get GitLab MR diff: ${res.status}`);
  }

  const entries = (await res.json()) as Array<{
    old_path: string;
    new_path: string;
    new_file: boolean;
    deleted_file: boolean;
    diff: string;
  }>;

  const parts: string[] = [];
  for (const e of entries) {
    const oldPath = e.deleted_file ? "/dev/null" : `a/${e.old_path}`;
    const newPath = e.new_file ? "/dev/null" : `b/${e.new_path}`;
    parts.push(`diff --git a/${e.old_path} b/${e.new_path}`);
    if (e.new_file) parts.push("new file mode 100644");
    if (e.deleted_file) parts.push("deleted file mode 100644");
    parts.push(`--- ${oldPath}`);
    parts.push(`+++ ${newPath}`);
    parts.push(e.diff.replace(/\n$/, ""));
  }

  const diff = parts.join("\n");
  return diff.length > 30_000
    ? diff.slice(0, 30_000) + "\n\n[... diff truncated at 30,000 chars]"
    : diff;
}

export async function createPullRequestComment(
  organizationId: string,
  projectPath: string,
  mrIid: number,
  body: string,
): Promise<number> {
  const token = await getAccessToken(organizationId);
  const host = await getHost(organizationId);
  const res = await fetch(
    `${apiBase(host)}/projects/${encodeURIComponent(projectPath)}/merge_requests/${mrIid}/notes`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    },
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Failed to create GitLab MR note: ${res.status} ${errBody}`);
  }

  const data = await res.json();
  return data.id as number;
}

export async function updatePullRequestComment(
  organizationId: string,
  projectPath: string,
  mrIid: number,
  noteId: number,
  body: string,
): Promise<void> {
  const token = await getAccessToken(organizationId);
  const host = await getHost(organizationId);
  const res = await fetch(
    `${apiBase(host)}/projects/${encodeURIComponent(projectPath)}/merge_requests/${mrIid}/notes/${noteId}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    },
  );

  if (!res.ok) {
    throw new Error(`Failed to update GitLab MR note: ${res.status}`);
  }
}

export async function createInlineComment(
  organizationId: string,
  projectPath: string,
  mrIid: number,
  filePath: string,
  line: number,
  body: string,
): Promise<number> {
  const token = await getAccessToken(organizationId);
  const host = await getHost(organizationId);

  // GitLab inline (positional) discussions need diff_refs from the MR.
  const mrRes = await fetch(
    `${apiBase(host)}/projects/${encodeURIComponent(projectPath)}/merge_requests/${mrIid}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!mrRes.ok) {
    throw new Error(`Failed to get MR for inline comment: ${mrRes.status}`);
  }
  const mrData = await mrRes.json();
  const refs = mrData.diff_refs as { base_sha: string; head_sha: string; start_sha: string } | undefined;
  if (!refs) {
    throw new Error("MR has no diff_refs — cannot create inline comment");
  }

  const res = await fetch(
    `${apiBase(host)}/projects/${encodeURIComponent(projectPath)}/merge_requests/${mrIid}/discussions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        body,
        position: {
          base_sha: refs.base_sha,
          head_sha: refs.head_sha,
          start_sha: refs.start_sha,
          position_type: "text",
          new_path: filePath,
          old_path: filePath,
          new_line: line,
        },
      }),
    },
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Failed to create GitLab inline comment: ${res.status} ${errBody}`);
  }

  const data = await res.json();
  return data.id as number;
}

// ── Repository Tree & Content ──

export async function getRepositoryTree(
  organizationId: string,
  projectPath: string,
  branch: string,
): Promise<string[]> {
  const token = await getAccessToken(organizationId);
  const host = await getHost(organizationId);
  const paths: string[] = [];
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
          console.warn(`[gitlab] Rate limited, waiting ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }

        return res;
      } catch (err) {
        if (attempt === MAX_RETRIES - 1) {
          console.warn(`[gitlab] Failed after ${MAX_RETRIES} attempts: ${url}`, err);
          return null;
        }
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }

  // GitLab supports recursive tree traversal in a single endpoint with pagination.
  let url: string | null =
    `${apiBase(host)}/projects/${encodeURIComponent(projectPath)}/repository/tree?ref=${encodeURIComponent(branch)}&recursive=true&per_page=100&pagination=keyset`;

  while (url) {
    const res = await fetchWithRetry(url);
    if (!res || !res.ok) {
      if (res) console.warn(`[gitlab] Failed to fetch tree ${url}: ${res.status}`);
      break;
    }

    const items = (await res.json()) as Array<{ type: string; path: string }>;
    for (const item of items) {
      if (item.type === "blob") paths.push(item.path);
    }

    url = parseNextLink(res.headers.get("link"));
  }

  return paths;
}

export async function getFileContent(
  organizationId: string,
  projectPath: string,
  branch: string,
  filePath: string,
): Promise<string> {
  const token = await getAccessToken(organizationId);
  const host = await getHost(organizationId);
  const res = await fetch(
    `${apiBase(host)}/projects/${encodeURIComponent(projectPath)}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${encodeURIComponent(branch)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) {
    throw new Error(`Failed to get GitLab file content: ${res.status}`);
  }

  return res.text();
}

// ── Webhooks ──
//
// Group-level hooks are a Premium feature on gitlab.com. To stay on the free tier
// and remain self-hosted-friendly, we register one project hook per repo at sync
// time. Each hook carries the same shared secret stored on the integration.

export async function createProjectWebhook(
  organizationId: string,
  projectPath: string,
  callbackUrl: string,
  secret: string,
): Promise<number | null> {
  const token = await getAccessToken(organizationId);
  const host = await getHost(organizationId);
  const res = await fetch(
    `${apiBase(host)}/projects/${encodeURIComponent(projectPath)}/hooks`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: callbackUrl,
        token: secret,
        merge_requests_events: true,
        note_events: true,
        push_events: false,
        enable_ssl_verification: true,
      }),
    },
  );

  if (!res.ok) {
    const errBody = await res.text();
    console.error(`[gitlab] Failed to create webhook on ${projectPath}: ${res.status} ${errBody}`);
    return null;
  }

  const data = await res.json();
  return (data.id as number) ?? null;
}

export async function deleteProjectWebhook(
  organizationId: string,
  projectPath: string,
  hookId: number,
): Promise<void> {
  const token = await getAccessToken(organizationId);
  const host = await getHost(organizationId);
  const res = await fetch(
    `${apiBase(host)}/projects/${encodeURIComponent(projectPath)}/hooks/${hookId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (!res.ok) {
    console.error(`[gitlab] Failed to delete webhook: ${res.status}`);
  }
}
