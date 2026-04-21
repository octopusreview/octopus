import { prisma } from "@octopus/db";
import { decryptString, encryptString } from "@/lib/crypto";

const AUTH_BASE = "https://auth.atlassian.com";
const API_BASE = "https://api.atlassian.com";

export const JIRA_OAUTH_PENDING_COOKIE = "jira_oauth_pending";

export type JiraOAuthPendingPayload = {
  orgId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  sites: { cloudId: string; name: string; url: string }[];
};

export class JiraAuthError extends Error {
  constructor() {
    super(
      "Jira access has been revoked or expired. Please reconnect Jira in Settings → Integrations.",
    );
    this.name = "JiraAuthError";
  }
}

// Tokens are stored encrypted at rest (AES-256-GCM, see lib/crypto.ts).
// JiraIntegrationRecord carries the encrypted ciphertexts; getValidAccessToken
// decrypts internally and exposes the plaintext access token to callers.
export type JiraIntegrationRecord = {
  id: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  cloudId: string;
  siteUrl: string;
};

export function encryptJiraToken(plaintext: string): string {
  return encryptString(plaintext);
}

export function decryptJiraToken(ciphertext: string): string {
  return decryptString(ciphertext);
}

export type JiraAccessibleResource = {
  id: string;
  name: string;
  url: string;
  scopes: string[];
};

export type JiraProject = {
  id: string;
  key: string;
  name: string;
  issueTypes: { id: string; name: string }[];
};

export type JiraIssueStatus = {
  state: string;
  url: string;
  key: string;
};

// ── Token refresh ──────────────────────────────────────────────

export async function getValidAccessToken(
  integration: JiraIntegrationRecord,
): Promise<string> {
  const now = Date.now();
  const expiresAt = integration.tokenExpiresAt.getTime();
  // refresh if less than 60 seconds remaining
  if (expiresAt - now > 60_000) {
    return decryptString(integration.accessToken);
  }

  const clientId = process.env.JIRA_CLIENT_ID;
  const clientSecret = process.env.JIRA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Jira OAuth client is not configured");
  }

  const res = await fetch(`${AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: decryptString(integration.refreshToken),
    }),
  });

  if (!res.ok) {
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw new JiraAuthError();
    }
    const text = await res.text().catch(() => "");
    throw new Error(`Jira token refresh failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const newExpiresAt = new Date(Date.now() + data.expires_in * 1000);
  const encryptedAccess = encryptString(data.access_token);
  const encryptedRefresh = encryptString(data.refresh_token);
  await prisma.jiraIntegration.update({
    where: { id: integration.id },
    data: {
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      tokenExpiresAt: newExpiresAt,
    },
  });

  integration.accessToken = encryptedAccess;
  integration.refreshToken = encryptedRefresh;
  integration.tokenExpiresAt = newExpiresAt;
  return data.access_token;
}

async function jiraApi<T>(
  integration: JiraIntegrationRecord,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await getValidAccessToken(integration);
  const url = `${API_BASE}/ex/jira/${integration.cloudId}/rest/api/3${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 || res.status === 403) {
    throw new JiraAuthError();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Jira API error (${res.status}): ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ── OAuth helpers ──────────────────────────────────────────────

export async function getAccessibleResources(
  accessToken: string,
): Promise<JiraAccessibleResource[]> {
  const res = await fetch(`${API_BASE}/oauth/token/accessible-resources`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new JiraAuthError();
    const text = await res.text().catch(() => "");
    throw new Error(
      `Failed to list accessible Jira sites (${res.status}): ${text}`,
    );
  }
  return (await res.json()) as JiraAccessibleResource[];
}

// ── Project + issue type listing ───────────────────────────────

type JiraProjectSearchResponse = {
  isLast?: boolean;
  nextPage?: string;
  values: {
    id: string;
    key: string;
    name: string;
    issueTypes?: { id: string; name: string; subtask?: boolean }[];
  }[];
};

export async function getJiraProjects(
  integration: JiraIntegrationRecord,
): Promise<JiraProject[]> {
  const projects: JiraProject[] = [];
  let startAt = 0;
  const pageSize = 50;

  // paginated project search with issueTypes expansion
  while (true) {
    const data = await jiraApi<JiraProjectSearchResponse>(
      integration,
      "GET",
      `/project/search?expand=issueTypes&startAt=${startAt}&maxResults=${pageSize}`,
    );
    for (const p of data.values) {
      projects.push({
        id: p.id,
        key: p.key,
        name: p.name,
        issueTypes: (p.issueTypes ?? [])
          .filter((t) => !t.subtask)
          .map((t) => ({ id: t.id, name: t.name })),
      });
    }
    if (data.isLast || data.values.length < pageSize) break;
    startAt += pageSize;
    // safety cap
    if (startAt > 1000) break;
  }

  return projects;
}

// ── Issue creation ─────────────────────────────────────────────

type AdfNode =
  | { type: "paragraph"; content: { type: "text"; text: string }[] }
  | {
      type: "heading";
      attrs: { level: number };
      content: { type: "text"; text: string }[];
    };

function textToAdf(text: string): {
  version: 1;
  type: "doc";
  content: AdfNode[];
} {
  const content: AdfNode[] = [];
  const lines = text.split(/\r?\n/);
  let paragraphBuffer: string[] = [];

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) return;
    const joined = paragraphBuffer.join("\n").trim();
    if (joined) {
      content.push({
        type: "paragraph",
        content: [{ type: "text", text: joined }],
      });
    }
    paragraphBuffer = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      const level = Math.min(6, headingMatch[1].length);
      const headingText = headingMatch[2].trim();
      if (headingText) {
        content.push({
          type: "heading",
          attrs: { level },
          content: [{ type: "text", text: headingText }],
        });
      }
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      continue;
    }
    paragraphBuffer.push(line);
  }
  flushParagraph();

  if (content.length === 0) {
    content.push({
      type: "paragraph",
      content: [{ type: "text", text: text || " " }],
    });
  }

  return { version: 1, type: "doc", content };
}

export async function createJiraIssue(
  integration: JiraIntegrationRecord,
  projectId: string,
  issueTypeId: string,
  title: string,
  description: string,
): Promise<{ id: string; key: string; url: string }> {
  const payload = {
    fields: {
      project: { id: projectId },
      issuetype: { id: issueTypeId },
      summary: title.slice(0, 255),
      description: textToAdf(description),
    },
  };

  const data = await jiraApi<{ id: string; key: string }>(
    integration,
    "POST",
    "/issue",
    payload,
  );

  return {
    id: data.id,
    key: data.key,
    url: `${integration.siteUrl.replace(/\/$/, "")}/browse/${data.key}`,
  };
}

// ── Issue status batch lookup ──────────────────────────────────

type JiraSearchResponse = {
  issues: {
    id: string;
    key: string;
    fields: { status?: { name: string } };
  }[];
};

export async function getJiraIssueStatuses(
  integration: JiraIntegrationRecord,
  issueKeys: string[],
): Promise<Map<string, JiraIssueStatus>> {
  const map = new Map<string, JiraIssueStatus>();
  if (issueKeys.length === 0) return map;

  const keys = issueKeys
    .filter((k) => /^[A-Z][A-Z0-9]+-\d+$/.test(k))
    .map((k) => `"${k}"`);
  if (keys.length === 0) return map;

  const jql = `key in (${keys.join(",")})`;
  const data = await jiraApi<JiraSearchResponse>(
    integration,
    "POST",
    "/search/jql",
    { jql, fields: ["status"], maxResults: Math.min(keys.length, 100) },
  );

  const baseUrl = integration.siteUrl.replace(/\/$/, "");
  for (const issue of data.issues) {
    map.set(issue.key, {
      state: issue.fields.status?.name ?? "Unknown",
      url: `${baseUrl}/browse/${issue.key}`,
      key: issue.key,
    });
  }
  return map;
}
