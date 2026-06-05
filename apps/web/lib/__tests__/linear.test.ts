import { afterEach, describe, expect, it, mock } from "bun:test";

import {
  createLinearIssue,
  getLinearIssueStatuses,
  getLinearTeams,
  LinearAuthError,
} from "@/lib/linear";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

function mockLinearResponse(data: unknown) {
  globalThis.fetch = mock(async () =>
    new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("Linear integration helpers", () => {
  it("returns team mappings from the Linear teams query", async () => {
    mockLinearResponse({
      teams: {
        nodes: [
          { id: "team-1", name: "Engineering", key: "ENG" },
          { id: "team-2", name: "Design", key: "DES" },
        ],
      },
    });

    const teams = await getLinearTeams("linear-token");

    expect(teams).toEqual([
      { id: "team-1", name: "Engineering", key: "ENG" },
      { id: "team-2", name: "Design", key: "DES" },
    ]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.linear.app/graphql",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer linear-token",
          "Content-Type": "application/json",
        },
      }),
    );
  });

  it("sends the expected payload when creating a Linear issue", async () => {
    mockLinearResponse({
      issueCreate: {
        issue: {
          id: "issue-1",
          url: "https://linear.app/acme/issue/ENG-123/fix-bug",
          identifier: "ENG-123",
        },
      },
    });

    const issue = await createLinearIssue(
      "linear-token",
      "team-1",
      "Fix bug",
      "Issue details",
      2,
    );

    expect(issue).toEqual({
      id: "issue-1",
      url: "https://linear.app/acme/issue/ENG-123/fix-bug",
      identifier: "ENG-123",
    });

    const [, init] = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(JSON.parse(init.body as string)).toMatchObject({
      variables: {
        teamId: "team-1",
        title: "Fix bug",
        description: "Issue details",
        priority: 2,
      },
    });
  });

  it("maps Linear issue statuses by issue id", async () => {
    mockLinearResponse({
      issues: {
        nodes: [
          {
            id: "issue-1",
            identifier: "ENG-123",
            url: "https://linear.app/acme/issue/ENG-123/fix-bug",
            state: { name: "Done" },
          },
        ],
      },
    });

    const statuses = await getLinearIssueStatuses(["issue-1"], "linear-token");

    expect(statuses.get("issue-1")).toEqual({
      state: "Done",
      url: "https://linear.app/acme/issue/ENG-123/fix-bug",
      identifier: "ENG-123",
    });
  });

  it("throws LinearAuthError for auth failures", async () => {
    globalThis.fetch = mock(async () => new Response("Forbidden", { status: 403 })) as unknown as typeof fetch;

    await expect(getLinearTeams("revoked-token")).rejects.toBeInstanceOf(
      LinearAuthError,
    );
  });

  it("throws a useful error for non-auth API failures", async () => {
    globalThis.fetch = mock(async () =>
      new Response("rate limited", { status: 429 }),
    ) as unknown as typeof fetch;

    await expect(getLinearTeams("linear-token")).rejects.toThrow(
      "Linear API error (429): rate limited",
    );
  });

  it("throws GraphQL error messages returned by Linear", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({ errors: [{ message: "Team not found" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    await expect(getLinearTeams("linear-token")).rejects.toThrow(
      "Linear GraphQL error: Team not found",
    );
  });
});
