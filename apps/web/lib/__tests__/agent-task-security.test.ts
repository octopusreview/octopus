import { beforeEach, describe, expect, it, mock } from "bun:test";

type FakeAgent = {
  id: string;
  name: string;
  status: string;
  organizationId: string;
  apiTokenId: string;
  apiToken: { deletedAt: Date | null; expiresAt: Date | null };
  repoFullNames: string[];
  capabilities: string[];
  machineInfo: Record<string, unknown> | null;
};

type FakeTask = {
  id: string;
  organizationId: string;
  status: string;
  agentId: string | null;
  agent: { organizationId: string; apiTokenId: string } | null;
  repoFullName: string;
  searchType: string;
  result?: unknown;
  resultSummary?: string | null;
  errorMessage?: string | null;
};

type FakeLlmTask = {
  id: string;
  organizationId: string;
  status: string;
  agentId: string | null;
  agent: { organizationId: string; apiTokenId: string } | null;
  claimedAt: Date | null;
  modelId: string;
  system: string | null;
  messages: unknown[];
  maxTokens: number;
  createdAt: Date;
  resultText?: string | null;
  resultUsage?: unknown;
  errorMessage?: string | null;
};

const AUTH = {
  org: { id: "org_owner" },
  token: { id: "token_owner" },
  user: null,
};

let fakeAgent: FakeAgent | null;
let fakeTask: FakeTask | null;
let fakeLlmTask: FakeLlmTask | null;
let forceTerminalRace: boolean;
let currentAuth: typeof AUTH;

function matchesValue(actual: unknown, expected: unknown): boolean {
  if (
    expected !== null &&
    typeof expected === "object" &&
    !Array.isArray(expected)
  ) {
    const condition = expected as Record<string, unknown>;
    if (Array.isArray(condition.in)) {
      return condition.in.includes(actual);
    }
    if ("not" in condition) {
      return actual !== condition.not;
    }
    if (condition.lt instanceof Date) {
      return actual instanceof Date && actual < condition.lt;
    }
    if ("equals" in condition) {
      return actual === condition.equals;
    }
  }
  return actual === expected;
}

function matchesAgent(
  agent: FakeAgent | null,
  where: Record<string, unknown> | undefined,
): agent is FakeAgent {
  if (!agent || !where) return false;
  return Object.entries(where).every(([field, expected]) => {
    if (field === "OR") {
      return (expected as Record<string, unknown>[]).some((condition) =>
        matchesAgent(agent, condition),
      );
    }
    if (field === "organizationId_name") {
      const compound = expected as {
        organizationId?: unknown;
        name?: unknown;
      };
      return (
        matchesValue(agent.organizationId, compound.organizationId) &&
        matchesValue(agent.name, compound.name)
      );
    }
    if (field === "repoFullNames") {
      const condition = expected as { array_contains?: unknown[] };
      return (
        !condition.array_contains ||
        condition.array_contains.every((repo) =>
          agent.repoFullNames.includes(String(repo)),
        )
      );
    }
    if (field === "apiToken") {
      const relation = expected as {
        is?: Record<string, unknown>;
      };
      const condition = relation.is ?? relation;
      return Object.entries(condition).every(([key, value]) =>
        matchesValue(
          agent.apiToken[key as keyof FakeAgent["apiToken"]],
          value,
        ),
      );
    }
    return matchesValue(agent[field as keyof FakeAgent], expected);
  });
}

function matchesTask(
  task: FakeTask | null,
  where: Record<string, unknown> | undefined,
): task is FakeTask {
  if (!task || !where) return false;
  return Object.entries(where).every(([field, expected]) => {
    if (field === "agent") {
      const relation = expected as {
        is?: Record<string, unknown>;
        apiTokenId?: unknown;
      };
      const condition = relation.is ?? relation;
      return (
        task.agent !== null &&
        Object.entries(condition).every(([key, value]) =>
          matchesValue(
            task.agent?.[key as keyof NonNullable<FakeTask["agent"]>],
            value,
          ),
        )
      );
    }
    return matchesValue(task[field as keyof FakeTask], expected);
  });
}

function matchesLlmTask(
  task: FakeLlmTask | null,
  where: Record<string, unknown> | undefined,
): task is FakeLlmTask {
  if (!task || !where) return false;
  return Object.entries(where).every(([field, expected]) => {
    if (field === "agent") {
      const relation = expected as { is?: Record<string, unknown> };
      const condition = relation.is ?? relation;
      return (
        task.agent !== null &&
        Object.entries(condition).every(([key, value]) =>
          matchesValue(
            task.agent?.[key as keyof NonNullable<FakeLlmTask["agent"]>],
            value,
          ),
        )
      );
    }
    return matchesValue(task[field as keyof FakeLlmTask], expected);
  });
}

function applyAgentData(data: Partial<FakeAgent>) {
  Object.assign(fakeAgent!, data);
  if (typeof data.apiTokenId === "string") {
    fakeAgent!.apiToken = { deletedAt: null, expiresAt: null };
  }
}

const authenticateApiToken = mock(() => Promise.resolve(currentAuth));
const localAgentFindFirst = mock(
  ({ where }: { where?: Record<string, unknown> }) =>
    Promise.resolve(matchesAgent(fakeAgent, where) ? fakeAgent : null),
);
const localAgentFindUnique = mock(
  ({ where }: { where?: Record<string, unknown> }) =>
    Promise.resolve(matchesAgent(fakeAgent, where) ? fakeAgent : null),
);
const localAgentUpdate = mock(
  ({
    where,
    data,
  }: {
    where?: Record<string, unknown>;
    data: Partial<FakeAgent>;
  }) => {
    if (!matchesAgent(fakeAgent, where)) {
      throw new Error("Agent not found");
    }
    applyAgentData(data);
    return Promise.resolve(fakeAgent);
  },
);
const localAgentUpdateMany = mock(
  ({
    where,
    data,
  }: {
    where?: Record<string, unknown>;
    data: Partial<FakeAgent>;
  }) => {
    if (!matchesAgent(fakeAgent, where)) {
      return Promise.resolve({ count: 0 });
    }
    applyAgentData(data);
    return Promise.resolve({ count: 1 });
  },
);
const localAgentCreate = mock(
  ({ data }: { data: Omit<FakeAgent, "id" | "status"> }) => {
    if (
      fakeAgent &&
      fakeAgent.organizationId === data.organizationId &&
      fakeAgent.name === data.name
    ) {
      return Promise.reject(new Error("Unique constraint failed"));
    }
    fakeAgent = {
      id: "agent_created",
      status: "online",
      ...data,
    };
    return Promise.resolve(fakeAgent);
  },
);
const localAgentUpsert = mock(
  ({
    where,
    update,
    create,
  }: {
    where?: Record<string, unknown>;
    update: Partial<FakeAgent>;
    create: Omit<FakeAgent, "id" | "status">;
  }) => {
    if (matchesAgent(fakeAgent, where)) {
      applyAgentData(update);
      return Promise.resolve(fakeAgent);
    }
    fakeAgent = {
      id: "agent_created",
      status: "online",
      ...create,
    };
    return Promise.resolve(fakeAgent);
  },
);
const taskFindFirst = mock(({ where }: { where?: Record<string, unknown> }) =>
  Promise.resolve(matchesTask(fakeTask, where) ? fakeTask : null),
);
const taskFindUnique = mock(({ where }: { where?: Record<string, unknown> }) =>
  Promise.resolve(matchesTask(fakeTask, where) ? fakeTask : null),
);
const taskFindMany = mock(() => Promise.resolve([]));
const taskUpdateMany = mock(
  ({
    where,
    data,
  }: {
    where?: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => {
    if (forceTerminalRace && data.status !== "claimed" && fakeTask) {
      fakeTask.status = "timeout";
      return Promise.resolve({ count: 0 });
    }

    if (!matchesTask(fakeTask, where)) {
      return Promise.resolve({ count: 0 });
    }

    Object.assign(fakeTask, data);
    if (typeof data.agentId === "string" && fakeAgent) {
      fakeTask!.agent = {
        organizationId: fakeAgent.organizationId,
        apiTokenId: fakeAgent.apiTokenId,
      };
    }
    return Promise.resolve({ count: 1 });
  },
);
const taskUpdate = mock(() => {
  throw new Error("Agent task terminal transitions must use updateMany");
});
const llmTaskFindFirst = mock(
  ({ where }: { where?: Record<string, unknown> }) =>
    Promise.resolve(matchesLlmTask(fakeLlmTask, where) ? fakeLlmTask : null),
);
const llmTaskFindUnique = mock(
  ({ where }: { where?: Record<string, unknown> }) =>
    Promise.resolve(matchesLlmTask(fakeLlmTask, where) ? fakeLlmTask : null),
);
const llmTaskFindMany = mock(
  ({ where }: { where?: Record<string, unknown> }) =>
    Promise.resolve(matchesLlmTask(fakeLlmTask, where) ? [fakeLlmTask] : []),
);
const llmTaskUpdateMany = mock(
  ({
    where,
    data,
  }: {
    where?: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => {
    if (!matchesLlmTask(fakeLlmTask, where)) {
      return Promise.resolve({ count: 0 });
    }
    Object.assign(fakeLlmTask, data);
    if (typeof data.agentId === "string" && fakeAgent) {
      fakeLlmTask!.agent = {
        organizationId: fakeAgent.organizationId,
        apiTokenId: fakeAgent.apiTokenId,
      };
    }
    return Promise.resolve({ count: 1 });
  },
);
const pubbyTrigger = mock(() => Promise.resolve());

mock.module("@/lib/api-auth", () => ({ authenticateApiToken }));
mock.module("@/lib/pubby", () => ({
  pubby: { trigger: pubbyTrigger },
}));
mock.module("server-only", () => ({}));
mock.module("@octopus/db", () => ({
  prisma: {
    localAgent: {
      findFirst: localAgentFindFirst,
      findUnique: localAgentFindUnique,
      update: localAgentUpdate,
      updateMany: localAgentUpdateMany,
      create: localAgentCreate,
      upsert: localAgentUpsert,
    },
    agentSearchTask: {
      findFirst: taskFindFirst,
      findUnique: taskFindUnique,
      findMany: taskFindMany,
      updateMany: taskUpdateMany,
      update: taskUpdate,
    },
    agentLlmTask: {
      findFirst: llmTaskFindFirst,
      findUnique: llmTaskFindUnique,
      findMany: llmTaskFindMany,
      updateMany: llmTaskUpdateMany,
    },
  },
}));

const { POST: claimTask } =
  await import("@/app/api/agent/tasks/[id]/claim/route");
const { POST: submitResult } =
  await import("@/app/api/agent/tasks/[id]/result/route");
const { GET: pollTasks } = await import("@/app/api/agent/tasks/route");
const { POST: registerAgent } = await import("@/app/api/agent/register/route");
const { POST: heartbeatAgent } = await import(
  "@/app/api/agent/heartbeat/route"
);
const { POST: disconnectAgent } = await import(
  "@/app/api/agent/disconnect/route"
);
const { GET: pollLlmTasks } = await import(
  "@/app/api/agent/llm-tasks/route"
);
const { POST: completeLlmTask } = await import(
  "@/app/api/agent/llm-tasks/[id]/complete/route"
);

function request(path: string, body: unknown): Request {
  return new Request(`https://app.test${path}`, {
    method: "POST",
    headers: {
      authorization: "Bearer oct_test",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function params(id = "task_1") {
  return { params: Promise.resolve({ id }) };
}

function ownedAgent(overrides: Partial<FakeAgent> = {}): FakeAgent {
  return {
    id: "agent_owner",
    name: "owner-workstation",
    status: "online",
    organizationId: AUTH.org.id,
    apiTokenId: AUTH.token.id,
    apiToken: { deletedAt: null, expiresAt: null },
    repoFullNames: ["octopus/octopus"],
    capabilities: ["ripgrep"],
    machineInfo: { os: "darwin" },
    ...overrides,
  };
}

function claimedTask(overrides: Partial<FakeTask> = {}): FakeTask {
  return {
    id: "task_1",
    organizationId: AUTH.org.id,
    status: "claimed",
    agentId: "agent_owner",
    agent: { organizationId: AUTH.org.id, apiTokenId: AUTH.token.id },
    repoFullName: "octopus/octopus",
    searchType: "semantic",
    ...overrides,
  };
}

function claimedLlmTask(
  overrides: Partial<FakeLlmTask> = {},
): FakeLlmTask {
  return {
    id: "llm_task_1",
    organizationId: AUTH.org.id,
    status: "claimed",
    agentId: "agent_owner",
    agent: { organizationId: AUTH.org.id, apiTokenId: AUTH.token.id },
    claimedAt: new Date(),
    modelId: "claude-test",
    system: null,
    messages: [{ role: "user", content: "test" }],
    maxTokens: 100,
    createdAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  currentAuth = AUTH;
  fakeAgent = ownedAgent();
  fakeTask = claimedTask({ status: "pending", agentId: null, agent: null });
  fakeLlmTask = claimedLlmTask();
  forceTerminalRace = false;

  authenticateApiToken.mockClear();
  localAgentFindFirst.mockClear();
  localAgentFindUnique.mockClear();
  localAgentUpdate.mockClear();
  localAgentUpdateMany.mockClear();
  localAgentCreate.mockClear();
  localAgentUpsert.mockClear();
  taskFindFirst.mockClear();
  taskFindUnique.mockClear();
  taskFindMany.mockClear();
  taskUpdateMany.mockClear();
  taskUpdate.mockClear();
  llmTaskFindFirst.mockClear();
  llmTaskFindUnique.mockClear();
  llmTaskFindMany.mockClear();
  llmTaskUpdateMany.mockClear();
  pubbyTrigger.mockClear();
});

describe("agent registration ownership", () => {
  it("does not let another same-org API token take over an existing agent name", async () => {
    const original = {
      apiTokenId: fakeAgent!.apiTokenId,
      repoFullNames: [...fakeAgent!.repoFullNames],
      capabilities: [...fakeAgent!.capabilities],
      machineInfo: fakeAgent!.machineInfo,
    };
    currentAuth = {
      ...AUTH,
      token: { id: "token_other" },
    };

    const response = await registerAgent(
      request("/api/agent/register", {
        name: fakeAgent!.name,
        repoFullNames: ["private/stolen"],
        capabilities: ["claude-cli"],
        machineInfo: { os: "attacker" },
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Agent name is already registered to another active token",
    });
    expect(fakeAgent).toEqual(expect.objectContaining(original));
    expect(pubbyTrigger).not.toHaveBeenCalled();
  });

  it("lets the owning API token safely refresh its existing registration", async () => {
    const updatedRepos = ["octopus/octopus", "octopus/docs"];
    const updatedCapabilities = ["ripgrep", "claude-cli"];

    const response = await registerAgent(
      request("/api/agent/register", {
        name: fakeAgent!.name,
        repoFullNames: updatedRepos,
        capabilities: updatedCapabilities,
        machineInfo: { os: "darwin", hostname: "owner-host" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      agentId: fakeAgent!.id,
      channel: `private-agent-org-${AUTH.org.id}`,
      orgId: AUTH.org.id,
    });
    expect(fakeAgent).toEqual(
      expect.objectContaining({
        apiTokenId: AUTH.token.id,
        repoFullNames: updatedRepos,
        capabilities: updatedCapabilities,
        machineInfo: { os: "darwin", hostname: "owner-host" },
      }),
    );
    expect(pubbyTrigger).toHaveBeenCalledWith(
      `presence-org-${AUTH.org.id}`,
      "agent-online",
      {
        agentId: fakeAgent!.id,
        name: fakeAgent!.name,
        repos: updatedRepos,
        capabilities: updatedCapabilities,
      },
    );
  });

  it("lets a new token reclaim an agent name after the old token is deleted", async () => {
    fakeAgent = ownedAgent({
      apiTokenId: "token_deleted",
      apiToken: { deletedAt: new Date(Date.now() - 60_000), expiresAt: null },
    });
    const updatedRepos = ["octopus/reclaimed"];

    const response = await registerAgent(
      request("/api/agent/register", {
        name: fakeAgent.name,
        repoFullNames: updatedRepos,
        capabilities: ["ripgrep"],
      }),
    );

    expect(response.status).toBe(200);
    expect(fakeAgent).toEqual(
      expect.objectContaining({
        apiTokenId: AUTH.token.id,
        repoFullNames: updatedRepos,
        apiToken: { deletedAt: null, expiresAt: null },
      }),
    );
  });

  it("lets a new token reclaim an agent name after the old token expires", async () => {
    fakeAgent = ownedAgent({
      apiTokenId: "token_expired",
      apiToken: {
        deletedAt: null,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    const updatedRepos = ["octopus/reclaimed"];

    const response = await registerAgent(
      request("/api/agent/register", {
        name: fakeAgent.name,
        repoFullNames: updatedRepos,
        capabilities: ["ripgrep"],
      }),
    );

    expect(response.status).toBe(200);
    expect(fakeAgent).toEqual(
      expect.objectContaining({
        apiTokenId: AUTH.token.id,
        repoFullNames: updatedRepos,
        apiToken: { deletedAt: null, expiresAt: null },
      }),
    );
  });
});

describe("agent lifecycle ownership", () => {
  it("rejects heartbeat for an agent registered by another token", async () => {
    fakeAgent = ownedAgent({ apiTokenId: "token_other" });
    const originalStatus = fakeAgent.status;

    const response = await heartbeatAgent(
      request("/api/agent/heartbeat", { agentId: fakeAgent.id }),
    );

    expect(response.status).toBe(404);
    expect(fakeAgent.status).toBe(originalStatus);
    expect(localAgentUpdate).not.toHaveBeenCalled();
    expect(localAgentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: fakeAgent.id,
          organizationId: AUTH.org.id,
          apiTokenId: AUTH.token.id,
        }),
      }),
    );
  });

  it("rejects heartbeat repository scopes containing non-string entries", async () => {
    const originalRepos = [...fakeAgent!.repoFullNames];

    const response = await heartbeatAgent(
      request("/api/agent/heartbeat", {
        agentId: fakeAgent!.id,
        repoFullNames: ["octopus/octopus", 42],
      }),
    );

    expect(response.status).toBe(400);
    expect(fakeAgent!.repoFullNames).toEqual(originalRepos);
    expect(localAgentUpdate).not.toHaveBeenCalled();
    expect(localAgentUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects disconnect for an agent registered by another token", async () => {
    fakeAgent = ownedAgent({ apiTokenId: "token_other" });

    const response = await disconnectAgent(
      request("/api/agent/disconnect", { agentId: fakeAgent.id }),
    );

    expect(response.status).toBe(404);
    expect(fakeAgent.status).toBe("online");
    expect(localAgentUpdate).not.toHaveBeenCalled();
    expect(localAgentUpdateMany).not.toHaveBeenCalled();
    expect(pubbyTrigger).not.toHaveBeenCalled();
  });
});

describe("agent search task ownership", () => {
  it("rejects a malformed claim agentId before database access", async () => {
    const response = await claimTask(
      request("/api/agent/tasks/task_1/claim", { agentId: 42 }),
      params(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("agentId is required");
    expect(localAgentFindFirst).not.toHaveBeenCalled();
    expect(taskUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects an agent owned by another API token", async () => {
    fakeAgent = ownedAgent({ apiTokenId: "token_other" });

    const response = await claimTask(
      request("/api/agent/tasks/task_1/claim", {
        agentId: fakeAgent.id,
      }),
      params(),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Agent not found");
    expect(localAgentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: fakeAgent.id,
          organizationId: AUTH.org.id,
          apiTokenId: AUTH.token.id,
        }),
      }),
    );
    expect(taskUpdateMany).not.toHaveBeenCalled();
  });

  it("does not let an owned agent claim a task for an unwatched repository", async () => {
    fakeAgent = ownedAgent({ repoFullNames: ["octopus/other"] });

    const response = await claimTask(
      request("/api/agent/tasks/task_1/claim", {
        agentId: fakeAgent.id,
      }),
      params(),
    );

    expect(response.status).toBe(409);
    expect(fakeTask?.status).toBe("pending");
    expect(fakeTask?.agentId).toBeNull();
  });

  it("does not expose the queue through an agent owned by another token", async () => {
    fakeAgent = ownedAgent({ apiTokenId: "token_other" });
    const response = await pollTasks(
      new Request(`https://app.test/api/agent/tasks?agentId=${fakeAgent.id}`, {
        headers: { authorization: "Bearer oct_test" },
      }),
    );

    expect(response.status).toBe(404);
    expect(localAgentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: fakeAgent.id,
          organizationId: AUTH.org.id,
          apiTokenId: AUTH.token.id,
        }),
      }),
    );
    expect(taskFindMany).not.toHaveBeenCalled();
  });

  it("rejects a result from a token that does not own the claiming agent", async () => {
    fakeTask = claimedTask({
      agent: { organizationId: AUTH.org.id, apiTokenId: "token_other" },
    });

    const response = await submitResult(
      request("/api/agent/tasks/task_1/result", {
        results: [{ file: "safe.ts", line: 1, content: "safe" }],
        resultSummary: "safe",
      }),
      params(),
    );

    expect(response.status).toBe(403);
    expect(taskUpdateMany).not.toHaveBeenCalled();
    expect(pubbyTrigger).not.toHaveBeenCalled();
  });

  it("rejects an optional agentId that differs from the stored claimant", async () => {
    fakeTask = claimedTask();

    const response = await submitResult(
      request("/api/agent/tasks/task_1/result", {
        agentId: "agent_other",
        results: [],
        resultSummary: "safe",
      }),
      params(),
    );

    expect(response.status).toBe(403);
    expect(taskUpdateMany).not.toHaveBeenCalled();
    expect(pubbyTrigger).not.toHaveBeenCalled();
  });

  it("keeps a concurrently-terminal task unchanged and does not publish", async () => {
    fakeTask = claimedTask();
    forceTerminalRace = true;

    const response = await submitResult(
      request("/api/agent/tasks/task_1/result", {
        results: [{ file: "safe.ts", line: 1, content: "safe" }],
        resultSummary: "safe",
      }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "timeout" });
    expect(fakeTask.status).toBe("timeout");
    expect(taskUpdate).not.toHaveBeenCalled();
    expect(taskUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: fakeTask.id,
          organizationId: AUTH.org.id,
          agentId: fakeTask.agentId,
          status: "claimed",
        }),
      }),
    );
    expect(pubbyTrigger).not.toHaveBeenCalled();
  });

  it("stores an oversized structured result as bounded valid JSON", async () => {
    fakeTask = claimedTask();
    const oversized = {
      matches: [
        {
          file: "large.ts",
          line: 1,
          content: "x".repeat(60 * 1024),
        },
      ],
    };

    const response = await submitResult(
      request("/api/agent/tasks/task_1/result", {
        results: oversized,
        resultSummary: "large result",
      }),
      params(),
    );

    expect(response.status).toBe(200);
    const transition = taskUpdateMany.mock.calls.at(-1)?.[0] as {
      data: { result: unknown };
    };
    expect(() => JSON.stringify(transition.data.result)).not.toThrow();
    expect(JSON.stringify(transition.data.result).length).toBeLessThanOrEqual(
      50 * 1024,
    );
    expect(transition.data.result).toEqual(
      expect.objectContaining({ truncated: true }),
    );
  });

  it("rejects a result request larger than 1 MiB before database access", async () => {
    fakeTask = claimedTask();
    const serialized = JSON.stringify({
      results: { content: "x".repeat(1025 * 1024) },
      resultSummary: "too large",
    });
    const response = await submitResult(
      new Request("https://app.test/api/agent/tasks/task_1/result", {
        method: "POST",
        headers: {
          authorization: "Bearer oct_test",
          "content-type": "application/json",
          "content-length": String(new TextEncoder().encode(serialized).length),
        },
        body: serialized,
      }),
      params(),
    );

    expect(response.status).toBe(413);
    expect(taskFindFirst).not.toHaveBeenCalled();
    expect(taskUpdateMany).not.toHaveBeenCalled();
    expect(pubbyTrigger).not.toHaveBeenCalled();
  });

  it("accepts a multibyte answer summary below 1 MiB and applies its character cap", async () => {
    fakeTask = claimedTask({ searchType: "answer" });
    const summary = "😀".repeat(100_000);
    const serialized = JSON.stringify({ results: [], resultSummary: summary });
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThan(
      1024 * 1024,
    );

    const response = await submitResult(
      new Request("https://app.test/api/agent/tasks/task_1/result", {
        method: "POST",
        headers: {
          authorization: "Bearer oct_test",
          "content-type": "application/json",
          "content-length": String(new TextEncoder().encode(serialized).length),
        },
        body: serialized,
      }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(fakeTask.resultSummary).toBe(summary.slice(0, 100 * 1024));
    expect(fakeTask.resultSummary?.length).toBe(100 * 1024);
  });

  it("rejects deeply nested valid JSON without throwing or transitioning the task", async () => {
    fakeTask = claimedTask();
    // Bun's parser accepts this depth, while re-serialization exceeds its
    // call stack. The complete request remains below the 1 MiB body cap.
    const depth = 80_000;
    const serialized = `{"results":${"[".repeat(depth)}null${"]".repeat(depth)},"resultSummary":"nested"}`;

    const response = await submitResult(
      new Request("https://app.test/api/agent/tasks/task_1/result", {
        method: "POST",
        headers: {
          authorization: "Bearer oct_test",
          "content-type": "application/json",
          "content-length": String(new TextEncoder().encode(serialized).length),
        },
        body: serialized,
      }),
      params(),
    );

    expect(response.status).toBe(400);
    expect(taskUpdateMany).not.toHaveBeenCalled();
    expect(pubbyTrigger).not.toHaveBeenCalled();
  });

  it("accepts the existing result payload without agentId for its owning token", async () => {
    fakeTask = claimedTask();
    const results = [
      { file: "safe.ts", line: 7, content: "const safe = true" },
    ];

    const response = await submitResult(
      request("/api/agent/tasks/task_1/result", {
        results,
        resultSummary: "one safe match",
      }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "completed" });
    expect(fakeTask.status).toBe("completed");
    expect(fakeTask.result).toEqual(results);
    expect(fakeTask.resultSummary).toBe("one safe match");
    expect(taskUpdate).not.toHaveBeenCalled();
    expect(pubbyTrigger).toHaveBeenCalledWith(
      `private-agent-org-${AUTH.org.id}`,
      "agent-search-complete",
      { taskId: fakeTask.id, status: "completed" },
    );
  });
});

describe("agent LLM task ownership", () => {
  it("rejects null and primitive JSON bodies before database access", async () => {
    for (const body of [null, "primitive", 17]) {
      const response = await completeLlmTask(
        request("/api/agent/llm-tasks/llm_task_1/complete", body),
        params("llm_task_1"),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid request body" });
    }
    expect(llmTaskFindFirst).not.toHaveBeenCalled();
    expect(llmTaskUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects a completion request larger than 8 MiB before database access", async () => {
    const serialized = JSON.stringify({
      agentId: "agent_owner",
      text: "x".repeat(8 * 1024 * 1024),
    });
    const response = await completeLlmTask(
      new Request(
        "https://app.test/api/agent/llm-tasks/llm_task_1/complete",
        {
          method: "POST",
          headers: {
            authorization: "Bearer oct_test",
            "content-type": "application/json",
            "content-length": String(
              new TextEncoder().encode(serialized).length,
            ),
          },
          body: serialized,
        },
      ),
      params("llm_task_1"),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Request body too large" });
    expect(llmTaskFindFirst).not.toHaveBeenCalled();
    expect(llmTaskUpdateMany).not.toHaveBeenCalled();
  });

  it("does not expose the LLM queue through an agent owned by another token", async () => {
    fakeAgent = ownedAgent({ apiTokenId: "token_other" });

    const response = await pollLlmTasks(
      new Request(
        `https://app.test/api/agent/llm-tasks?agentId=${fakeAgent.id}`,
        { headers: { authorization: "Bearer oct_test" } },
      ),
    );

    expect(response.status).toBe(404);
    expect(llmTaskFindMany).not.toHaveBeenCalled();
    expect(llmTaskUpdateMany).not.toHaveBeenCalled();
  });

  it("keeps the LLM claim transition and re-fetch scoped to the organization", async () => {
    fakeLlmTask = claimedLlmTask({
      status: "pending",
      agentId: null,
      agent: null,
      claimedAt: null,
    });

    const response = await pollLlmTasks(
      new Request(
        `https://app.test/api/agent/llm-tasks?agentId=${fakeAgent!.id}`,
        { headers: { authorization: "Bearer oct_test" } },
      ),
    );

    expect(response.status).toBe(200);
    expect(fakeLlmTask.status).toBe("claimed");
    const claimTransition = llmTaskUpdateMany.mock.calls.find(
      ([input]) => input.data.agentId === fakeAgent!.id,
    )?.[0];
    expect(claimTransition).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: [fakeLlmTask.id] },
          organizationId: AUTH.org.id,
          status: "pending",
        }),
      }),
    );

    const claimedFetch = llmTaskFindMany.mock.calls.find(
      ([input]) => input.where?.agentId === fakeAgent!.id,
    )?.[0];
    expect(claimedFetch).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: [fakeLlmTask.id] },
          organizationId: AUTH.org.id,
          agentId: fakeAgent!.id,
          status: "claimed",
        }),
      }),
    );
  });

  it("rejects completion when the stored claimant belongs to another token", async () => {
    fakeLlmTask = claimedLlmTask({
      agent: { organizationId: AUTH.org.id, apiTokenId: "token_other" },
    });

    const response = await completeLlmTask(
      request("/api/agent/llm-tasks/llm_task_1/complete", {
        agentId: fakeLlmTask.agentId,
        text: "untrusted completion",
      }),
      params(fakeLlmTask.id),
    );

    expect([403, 404]).toContain(response.status);
    expect(fakeLlmTask.status).toBe("claimed");
    expect(llmTaskUpdateMany).not.toHaveBeenCalled();
  });

  it("atomically completes through the full org, agent, and token boundary", async () => {
    fakeLlmTask = claimedLlmTask();

    const response = await completeLlmTask(
      request("/api/agent/llm-tasks/llm_task_1/complete", {
        agentId: fakeLlmTask.agentId,
        text: "trusted completion",
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
      params(fakeLlmTask.id),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "completed" });
    expect(llmTaskUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: fakeLlmTask.id,
          organizationId: AUTH.org.id,
          agentId: fakeLlmTask.agentId,
          status: "claimed",
          agent: {
            is: {
              organizationId: AUTH.org.id,
              apiTokenId: AUTH.token.id,
            },
          },
        }),
      }),
    );
    expect(fakeLlmTask.status).toBe("completed");
  });

  it("truncates multibyte result text on a complete UTF-8 code-point boundary", async () => {
    fakeLlmTask = claimedLlmTask();
    const text = `a${"😀".repeat(600_000)}`;

    const response = await completeLlmTask(
      request("/api/agent/llm-tasks/llm_task_1/complete", {
        agentId: fakeLlmTask.agentId,
        text,
      }),
      params(fakeLlmTask.id),
    );

    expect(response.status).toBe(200);
    const transition = llmTaskUpdateMany.mock.calls.at(-1)?.[0] as {
      data: { resultText: string };
    };
    const stored = transition.data.resultText;
    expect(new TextEncoder().encode(stored).byteLength).toBeLessThanOrEqual(
      2_000_000,
    );
    expect(stored.startsWith("a")).toBeTrue();
    expect(stored.endsWith("😀")).toBeTrue();
    expect(stored).not.toContain("�");

    let brokenCodePoint = false;
    for (const codePoint of stored.slice(1)) {
      if (codePoint !== "😀") {
        brokenCodePoint = true;
        break;
      }
    }
    expect(brokenCodePoint).toBeFalse();
  });
});
