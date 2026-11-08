import "server-only";
import { reviewPublicationSignal, type ReviewExecutionWindow } from "./review-capacity";
import { readReviewJson } from "@/lib/review-fetch";
import { attachReviewPatches, type ReviewInput, type ReviewFileInput } from "@/lib/review-coverage";
import { prisma } from "@octopus/db";
import { truncateDiff, MAX_FETCH_DIFF_CHARS } from "@/lib/diff-truncate";
import { encryptString, decryptStringMaybeLegacy } from "@/lib/crypto";
import { withWebhookSetupLock } from "@/lib/integration-setup-lock";
import { WebhookSetupError } from "@/lib/integration-setup";
import { safeErrorDetails } from "@/lib/provider-failure";

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
  const newRefresh = (data.refresh_token as string) ?? refreshToken;

  await prisma.bitbucketIntegration.update({
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
    console.log(`[bitbucket] Token expiring soon for org ${organizationId}, refreshing...`);
    const refreshed = await refreshAccessToken(
      integration.id,
      decryptStringMaybeLegacy(integration.refreshToken),
    );
    return refreshed.accessToken;
  }

  return decryptStringMaybeLegacy(integration.accessToken);
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
  baseSha: string | null;
  /** PR description body (may be empty). Untrusted user content. */
  body: string;
}

export async function getPullRequestDetails(
  organizationId: string,
  workspace: string,
  repoSlug: string,
  prId: number,
  signal?: AbortSignal,
): Promise<PullRequestDetails> {
  const token = await getAccessToken(organizationId);
  const res = await fetch(
    `${BITBUCKET_API}/repositories/${workspace}/${repoSlug}/pullrequests/${prId}`,
    { headers: { Authorization: `Bearer ${token}` }, signal },
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
    baseSha: data.destination?.commit?.hash ?? null,
    body: data.summary?.raw ?? data.description ?? "",
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
  // Raw-fetch ceiling; generated/ignored filtering + the review cap happen downstream.
  return truncateDiff(diff, MAX_FETCH_DIFF_CHARS);
}

export async function createPullRequestComment(
  organizationId: string,
  workspace: string,
  repoSlug: string,
  prId: number,
  body: string,
  executionWindow?: ReviewExecutionWindow,
): Promise<number> {
  const token = await getAccessToken(organizationId);
  const signal = reviewPublicationSignal(executionWindow);
  const res = await fetch(
    `${BITBUCKET_API}/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/comments`,
    {
      signal,
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
  executionWindow?: ReviewExecutionWindow,
): Promise<void> {
  const token = await getAccessToken(organizationId);
  const signal = reviewPublicationSignal(executionWindow);
  const res = await fetch(
    `${BITBUCKET_API}/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/comments/${commentId}`,
    {
      signal,
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

/**
 * Fetch the HEAD commit SHA of a branch in a single cheap request. Used to
 * decide whether a cached file tree is still valid before walking the whole
 * tree (which costs one request per directory). Returns null on failure so
 * callers can fall back to walking the tree.
 */
export async function getBranchHead(
  organizationId: string,
  workspace: string,
  repoSlug: string,
  branch: string,
): Promise<string | null> {
  const token = await getAccessToken(organizationId);
  const res = await fetch(
    `${BITBUCKET_API}/repositories/${workspace}/${repoSlug}/refs/branches/${encodeURIComponent(branch)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    console.warn(`[bitbucket] Failed to get branch head for ${branch}: ${res.status}`);
    return null;
  }
  const data = await res.json();
  return data.target?.hash ?? null;
}

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
          console.warn(`[bitbucket] Failed to fetch tree after ${MAX_RETRIES} attempts:`, safeErrorDetails(err));
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
      if (res) console.warn(`[bitbucket] Failed to fetch tree: ${res.status}`);
      return [];
    }

    const data = await res.json();
    for (const item of data.values ?? []) {
      if (item.type === "commit_file") {
        paths.push(item.path);
      } else if (item.type === "commit_directory") {
        subDirs.push(
          `${BITBUCKET_API}/repositories/${workspace}/${repoSlug}/src/${encodeURIComponent(branch)}/${encodeURIComponent(item.path)}/?pagelen=100`,
        );
      }
    }

    if (data.next) {
      subDirs.push(data.next);
    }

    return subDirs;
  }

  // BFS with bounded concurrency
  const queue: string[] = [
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
  expectedBinding?: { id: string; workspaceSlug: string },
): Promise<string> {
  const integration = await getIntegration(organizationId);
  const binding = expectedBinding ?? integration;
  const checkBinding = (current: typeof integration | null) => {
    if (!current || current.id !== binding.id || current.workspaceSlug !== binding.workspaceSlug
      || current.workspaceSlug !== workspaceSlug || current.webhookSecret !== secret) {
      throw new WebhookSetupError("Bitbucket connection changed during setup. Retry setup for the current connection.");
    }
  };
  checkBinding(integration);
  // Repository listing refreshes tokens first. Keep one checked credential snapshot
  // here so reconnecting cannot combine an old workspace/secret with a new token.
  if (integration.tokenExpiresAt.getTime() - Date.now() < 60_000) {
    throw new WebhookSetupError("Bitbucket authorization expired during setup. Retry setup to refresh it.");
  }
  const token = decryptStringMaybeLegacy(integration.accessToken);
  const endpoint = `${BITBUCKET_API}/workspaces/${encodeURIComponent(workspaceSlug)}/hooks`;
  const description = `Octopus Review (${organizationId}) [${integration.id}]`;
  const events = ["pullrequest:created", "pullrequest:updated", "pullrequest:comment_created"];
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  return withWebhookSetupLock([`binding:bitbucket:${organizationId}`, `bitbucket:${workspaceSlug}`], async (tx) => {
    checkBinding(await tx.bitbucketIntegration.findUnique({ where: { organizationId } }));
    const deadline = AbortSignal.timeout(45_000); // Finish before the setup lock's transaction expires.
    type Hook = { uuid: string; url: string; description?: string; active?: boolean; events?: string[]; secret_set?: boolean };
    const hooks: Hook[] = [];
    for (let page = 1; ; page++) {
      if (page > 20) throw new WebhookSetupError("Bitbucket has too many webhooks to check safely. Check workspace webhook settings.");
      const response = await fetch(`${endpoint}?pagelen=100&page=${page}`, { headers, signal: AbortSignal.any([deadline, AbortSignal.timeout(10_000)]) });
      if (!response.ok) throw new WebhookSetupError("Could not check Bitbucket webhooks. Reconnect with webhook permissions using a workspace owner account, then retry setup.");
      const data = await response.json() as { values?: Hook[]; next?: string };
      if (!Array.isArray(data.values)) throw new WebhookSetupError("Bitbucket returned an invalid webhook list. Retry setup.");
      hooks.push(...data.values);
      // Construct pagination locally: never send credentials to a provider-supplied next URL.
      if (!data.next) break;
    }
    const owned = hooks.find(h => h.description === description);
    if (owned) {
      if (owned.url !== callbackUrl || !owned.active || owned.secret_set === false || !events.every(e => owned.events?.includes(e))) {
        throw new WebhookSetupError("The existing Octopus Bitbucket webhook needs attention. Check its callback URL, secret, enabled state and pull-request events in workspace settings, then retry setup.");
      }
      return owned.uuid;
    }
    if (hooks.some(h => h.url === callbackUrl && (h.description?.startsWith(`Octopus Review (${organizationId})`) || !/^Octopus Review \([^()\s]+\)(?: \[[^\]\s]+\])?$/.test(h.description ?? "")))) {
      throw new WebhookSetupError(`An existing Octopus Bitbucket webhook has no saved ownership evidence. Open “Repair an existing webhook” only after confirming it belongs to this organization. Use the current saved secret and exact connection-specific description from those details, verify its events, then retry setup. No duplicate was created.`);
    }
    checkBinding(await tx.bitbucketIntegration.findUnique({ where: { organizationId } }));
    const response = await fetch(endpoint, {
      method: "POST", headers, signal: AbortSignal.any([deadline, AbortSignal.timeout(10_000)]),
      body: JSON.stringify({ description, url: callbackUrl, active: true, secret, events }),
    });
    if (!response.ok) throw new WebhookSetupError("Could not create the Bitbucket webhook. Reconnect with webhook permissions using a workspace owner account, then retry setup.");
    const data = await response.json() as { uuid?: string };
    if (!data.uuid) throw new WebhookSetupError("Bitbucket did not confirm the new webhook. Retry setup to check whether it was created.");
    return data.uuid;
  });
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

export async function getPullRequestReviewInput(organizationId: string, workspace: string, repoSlug: string, prId: number, expectedHead: string | null): Promise<{ input: ReviewInput; rawDiff: string }> {
  const token = await getAccessToken(organizationId);
  const base = `${BITBUCKET_API}/repositories/${workspace}/${repoSlug}/pullrequests/${prId}`;
  type InputPage = { source?: { commit?: { hash?: string } }; destination?: { commit?: { hash?: string } }; size?: number; next?: string; values?: { old?: { path?: string }; new?: { path?: string }; status: string; lines_added?: number; lines_removed?: number }[] };
  const read = async (suffix: string) => {
    const response = await fetch(base + suffix, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Failed to get Bitbucket review input: ${response.status}`);
    return readReviewJson<InputPage>(response);
  };
  const before = await read("");
  const headSha = before.source?.commit?.hash;
  const baseSha = before.destination?.commit?.hash ?? null;
  if (!headSha || (expectedHead && headSha !== expectedHead)) throw new Error("PR revision changed before review input was fetched");
  const rawDiff = await getPullRequestDiff(organizationId, workspace, repoSlug, prId);
  const files: ReviewFileInput[] = [];
  let inventoryComplete = false, expectedFiles: number | null = null;
  for (let page = 1; page <= 30; page++) {
    const result = await read(`/diffstat?pagelen=100&page=${page}`);
    if (!Array.isArray(result.values)) throw new Error("Invalid Bitbucket changed-file response");
    if (typeof result.size === "number" && Number.isSafeInteger(result.size) && result.size >= 0) expectedFiles = result.size;
    for (const f of result.values) {
      const path = f.new?.path ?? f.old?.path;
      if (typeof path !== "string") throw new Error("Invalid Bitbucket changed-file entry");
      files.push({ path, previousPath: f.old?.path, change: f.status === "added" ? "added" : f.status === "removed" ? "removed" : f.status, additions: f.lines_added, deletions: f.lines_removed });
    }
    // Construct our own next URL so a response cannot redirect credentials.
    if (!result.next) { inventoryComplete = true; break; }
  }
  const after = await read("");
  if (after.source?.commit?.hash !== headSha || after.destination?.commit?.hash !== baseSha) throw new Error("PR revision changed while review input was being fetched");
  inventoryComplete = inventoryComplete && (expectedFiles === null || expectedFiles === files.length) && Boolean(baseSha);
  return { rawDiff, input: { provider: "bitbucket", headSha, baseSha, files: attachReviewPatches(files, rawDiff), expectedFiles: expectedFiles ?? (inventoryComplete ? files.length : null), inventoryComplete, limitations: inventoryComplete ? [] : ["Bitbucket changed-file inventory could not be verified completely."] } };
}
