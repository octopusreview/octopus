const LINEAR_API = "https://api.linear.app/graphql";

export class LinearAuthError extends Error {
  constructor() {
    super(
      "Linear access token has been revoked or expired. Please reconnect Linear in Settings → Integrations.",
    );
    this.name = "LinearAuthError";
  }
}

async function linearRequest<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new LinearAuthError();
    }
    const text = await res.text().catch(() => "");
    throw new Error(`Linear API error (${res.status}): ${text}`);
  }

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`Linear GraphQL error: ${json.errors[0].message}`);
  }

  return json.data as T;
}

export async function getLinearViewer(
  token: string,
): Promise<{ id: string; name: string; organization: { id: string; name: string } }> {
  const data = await linearRequest<{
    viewer: { id: string; name: string; organization: { id: string; name: string } };
  }>(
    token,
    `query {
      viewer {
        id
        name
        organization {
          id
          name
        }
      }
    }`,
  );
  return data.viewer;
}

export async function getLinearTeams(
  token: string,
): Promise<{ id: string; name: string; key: string }[]> {
  const data = await linearRequest<{
    teams: { nodes: { id: string; name: string; key: string }[] };
  }>(
    token,
    `query {
      teams {
        nodes {
          id
          name
          key
        }
      }
    }`,
  );
  return data.teams.nodes;
}

export async function createLinearIssue(
  token: string,
  teamId: string,
  title: string,
  description: string,
  priority?: number,
): Promise<{ id: string; url: string; identifier: string }> {
  const data = await linearRequest<{
    issueCreate: { issue: { id: string; url: string; identifier: string } };
  }>(
    token,
    `mutation CreateIssue($teamId: String!, $title: String!, $description: String, $priority: Int) {
      issueCreate(input: { teamId: $teamId, title: $title, description: $description, priority: $priority }) {
        issue {
          id
          url
          identifier
        }
      }
    }`,
    { teamId, title, description, priority },
  );
  return data.issueCreate.issue;
}

export async function getLinearIssueStatuses(
  issueIds: string[],
  token: string,
): Promise<Map<string, { state: string; url: string; identifier: string }>> {
  if (issueIds.length === 0) return new Map();

  // Linear GraphQL doesn't support fetching multiple issues by IDs directly in a simple way,
  // so we batch them using the issues query with a filter
  const data = await linearRequest<{
    issues: {
      nodes: {
        id: string;
        identifier: string;
        url: string;
        state: { name: string };
      }[];
    };
  }>(
    token,
    `query($ids: [ID!]) {
      issues(filter: { id: { in: $ids } }) {
        nodes {
          id
          identifier
          url
          state {
            name
          }
        }
      }
    }`,
    { ids: issueIds },
  );

  const map = new Map<string, { state: string; url: string; identifier: string }>();
  for (const issue of data.issues.nodes) {
    map.set(issue.id, {
      state: issue.state.name,
      url: issue.url,
      identifier: issue.identifier,
    });
  }
  return map;
}
