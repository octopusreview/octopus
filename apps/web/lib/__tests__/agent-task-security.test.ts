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

let currentAuth: typeof AUTH;
let agentFixture: FakeAgent;
let taskFixture: FakeTask;
let llmTaskFixture: FakeLlmTask;

// Every Prisma call consumes an explicitly scripted, projection-shaped
// response. These mocks deliberately do not interpret `where` or `select`:
// tests assert the security-critical query object separately, so they cannot
// pass because a homemade evaluator happened to mimic Prisma incorrectly.
type ScriptedResponse = unknown | Error;

let localAgentFindFirstResponses: ScriptedResponse[];
let localAgentFindUniqueResponses: ScriptedResponse[];
let localAgentUpdateResponses: ScriptedResponse[];
let localAgentUpdateManyResponses: ScriptedResponse[];
let localAgentCreateResponses: ScriptedResponse[];
let localAgentUpsertResponses: ScriptedResponse[];
let taskFindFirstResponses: ScriptedResponse[];
let taskFindUniqueResponses: ScriptedResponse[];
let taskFindManyResponses: ScriptedResponse[];
let taskUpdateManyResponses: ScriptedResponse[];
let llmTaskFindFirstResponses: ScriptedResponse[];
let llmTaskFindUniqueResponses: ScriptedResponse[];
let llmTaskFindManyResponses: ScriptedResponse[];
let llmTaskUpdateManyResponses: ScriptedResponse[];

async function nextResponse(
  operation: string,
  responses: ScriptedResponse[],
): Promise<unknown> {
  if (responses.length === 0) {
    throw new Error(`No scripted response for prisma.${operation}`);
  }
  const response = responses.shift();
  if (response instanceof Error) throw response;
  return response;
}

const authenticateApiToken = mock(() => Promise.resolve(currentAuth));
const localAgentFindFirst = mock(() =>
  nextResponse("localAgent.findFirst", localAgentFindFirstResponses),
);
const localAgentFindUnique = mock(() =>
  nextResponse("localAgent.findUnique", localAgentFindUniqueResponses),
);
const localAgentUpdate = mock(() =>
  nextResponse("localAgent.update", localAgentUpdateResponses),
);
const localAgentUpdateMany = mock(() =>
  nextResponse("localAgent.updateMany", localAgentUpdateManyResponses),
);
const localAgentCreate = mock(() =>
  nextResponse("localAgent.create", localAgentCreateResponses),
);
const localAgentUpsert = mock(() =>
  nextResponse("localAgent.upsert", localAgentUpsertResponses),
);
const taskFindFirst = mock(() =>
  nextResponse("agentSearchTask.findFirst", taskFindFirstResponses),
);
const taskFindUnique = mock(() =>
  nextResponse("agentSearchTask.findUnique", taskFindUniqueResponses),
);
const taskFindMany = mock(() =>
  nextResponse("agentSearchTask.findMany", taskFindManyResponses),
);
const taskUpdateMany = mock(() =>
  nextResponse("agentSearchTask.updateMany", taskUpdateManyResponses),
);
const taskUpdate = mock(() => {
  throw new Error("Agent task terminal transitions must use updateMany");
});
const llmTaskFindFirst = mock(() =>
  nextResponse("agentLlmTask.findFirst", llmTaskFindFirstResponses),
);
const llmTaskFindUnique = mock(() =>
  nextResponse("agentLlmTask.findUnique", llmTaskFindUniqueResponses),
);
const llmTaskFindMany = mock(() =>
  nextResponse("agentLlmTask.findMany", llmTaskFindManyResponses),
);
const llmTaskUpdateMany = mock(() =>
  nextResponse("agentLlmTask.updateMany", llmTaskUpdateManyResponses),
);
const pubbyTrigger = mock(() => Promise.resolve());
const PRISMA_DB_NULL = Symbol("Prisma.DbNull");

mock.module("@/lib/api-auth", () => ({ authenticateApiToken }));
mock.module("@/lib/pubby", () => ({
  pubby: { trigger: pubbyTrigger },
}));
mock.module("@/lib/prisma-json-null", () => ({ PRISMA_DB_NULL }));
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

function malformedRequest(path: string): Request {
  return new Request(`https://app.test${path}`, {
    method: "POST",
    headers: {
      authorization: "Bearer oct_test",
      "content-type": "application/json",
    },
    body: "{",
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

function searchTaskClaimProjection(task = claimedTask()) {
  return {
    agentId: task.agentId,
    searchType: task.searchType,
    status: task.status,
    agent: task.agent,
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

function llmTaskClaimProjection(task = claimedLlmTask()) {
  return {
    agentId: task.agentId,
    status: task.status,
    agent: task.agent,
  };
}

beforeEach(() => {
  currentAuth = AUTH;
  agentFixture = ownedAgent();
  taskFixture = claimedTask({ status: "pending", agentId: null, agent: null });
  llmTaskFixture = claimedLlmTask();

  localAgentFindFirstResponses = [];
  localAgentFindUniqueResponses = [];
  localAgentUpdateResponses = [];
  localAgentUpdateManyResponses = [];
  localAgentCreateResponses = [];
  localAgentUpsertResponses = [];
  taskFindFirstResponses = [];
  taskFindUniqueResponses = [];
  taskFindManyResponses = [];
  taskUpdateManyResponses = [];
  llmTaskFindFirstResponses = [];
  llmTaskFindUniqueResponses = [];
  llmTaskFindManyResponses = [];
  llmTaskUpdateManyResponses = [];

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
    currentAuth = {
      ...AUTH,
      token: { id: "token_other" },
    };
    localAgentUpdateManyResponses = [{ count: 0 }, { count: 0 }];
    localAgentCreateResponses = [new Error("Unique constraint failed")];
    localAgentFindUniqueResponses = [agentFixture];

    const response = await registerAgent(
      request("/api/agent/register", {
        name: agentFixture!.name,
        repoFullNames: ["private/stolen"],
        capabilities: ["claude-cli"],
        machineInfo: { os: "attacker" },
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Agent name is already registered to another active token",
    });
    expect(localAgentUpdateMany).toHaveBeenCalledTimes(2);
    expect(localAgentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: AUTH.org.id,
          name: agentFixture.name,
          OR: expect.arrayContaining([
            { apiTokenId: "token_other" },
            { apiToken: { is: { deletedAt: { not: null } } } },
            { apiToken: { is: { expiresAt: { lt: expect.any(Date) } } } },
          ]),
        }),
      }),
    );
    expect(pubbyTrigger).not.toHaveBeenCalled();
  });

  it("lets the owning API token safely refresh its existing registration", async () => {
    const updatedRepos = ["octopus/octopus", "octopus/docs"];
    const updatedCapabilities = ["ripgrep", "claude-cli"];
    const refreshedAgent = ownedAgent({
      repoFullNames: updatedRepos,
      capabilities: updatedCapabilities,
      machineInfo: { os: "darwin", hostname: "owner-host" },
    });
    localAgentUpdateManyResponses = [{ count: 1 }];
    localAgentFindUniqueResponses = [refreshedAgent];

    const response = await registerAgent(
      request("/api/agent/register", {
        name: agentFixture!.name,
        repoFullNames: updatedRepos,
        capabilities: updatedCapabilities,
        machineInfo: { os: "darwin", hostname: "owner-host" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      agentId: refreshedAgent.id,
      channel: `private-agent-org-${AUTH.org.id}`,
      orgId: AUTH.org.id,
    });
    expect(localAgentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: AUTH.org.id,
          name: agentFixture.name,
          OR: expect.arrayContaining([{ apiTokenId: AUTH.token.id }]),
        }),
        data: expect.objectContaining({
          apiTokenId: AUTH.token.id,
          repoFullNames: updatedRepos,
          capabilities: updatedCapabilities,
          machineInfo: { os: "darwin", hostname: "owner-host" },
        }),
      }),
    );
    expect(pubbyTrigger).toHaveBeenCalledWith(
      `presence-org-${AUTH.org.id}`,
      "agent-online",
      {
        agentId: refreshedAgent.id,
        name: refreshedAgent.name,
        repos: updatedRepos,
        capabilities: updatedCapabilities,
      },
    );
  });

  it("stores omitted or explicit-null machineInfo as database NULL", async () => {
    const refreshedAgent = ownedAgent({ machineInfo: null });
    localAgentUpdateManyResponses = [{ count: 1 }, { count: 1 }];
    localAgentFindUniqueResponses = [refreshedAgent, refreshedAgent];

    for (const machineInfo of [undefined, null]) {
      const response = await registerAgent(
        request("/api/agent/register", {
          name: agentFixture!.name,
          repoFullNames: agentFixture!.repoFullNames,
          ...(machineInfo === null ? { machineInfo } : {}),
        }),
      );

      expect(response.status).toBe(200);
    }

    for (const call of localAgentUpdateMany.mock.calls) {
      expect(call[0]).toEqual(
        expect.objectContaining({
          data: expect.objectContaining({ machineInfo: PRISMA_DB_NULL }),
        }),
      );
    }
  });

  it("lets a new token reclaim an agent name after the old token is soft-deleted", async () => {
    agentFixture = ownedAgent({
      apiTokenId: "token_deleted",
      apiToken: { deletedAt: new Date(Date.now() - 60_000), expiresAt: null },
    });
    const updatedRepos = ["octopus/reclaimed"];
    const reclaimedAgent = ownedAgent({ repoFullNames: updatedRepos });
    localAgentUpdateManyResponses = [{ count: 1 }];
    localAgentFindUniqueResponses = [reclaimedAgent];

    const response = await registerAgent(
      request("/api/agent/register", {
        name: agentFixture.name,
        repoFullNames: updatedRepos,
        capabilities: ["ripgrep"],
      }),
    );

    expect(response.status).toBe(200);
    expect(localAgentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { apiToken: { is: { deletedAt: { not: null } } } },
          ]),
        }),
        data: expect.objectContaining({
          apiTokenId: AUTH.token.id,
          repoFullNames: updatedRepos,
        }),
      }),
    );
  });

  it("lets a new token reclaim an agent name after the old token expires", async () => {
    agentFixture = ownedAgent({
      apiTokenId: "token_expired",
      apiToken: {
        deletedAt: null,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    const updatedRepos = ["octopus/reclaimed"];
    const reclaimedAgent = ownedAgent({ repoFullNames: updatedRepos });
    localAgentUpdateManyResponses = [{ count: 1 }];
    localAgentFindUniqueResponses = [reclaimedAgent];

    const response = await registerAgent(
      request("/api/agent/register", {
        name: agentFixture.name,
        repoFullNames: updatedRepos,
        capabilities: ["ripgrep"],
      }),
    );

    expect(response.status).toBe(200);
    expect(localAgentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            {
              apiToken: {
                is: { expiresAt: { lt: expect.any(Date) } },
              },
            },
          ]),
        }),
        data: expect.objectContaining({
          apiTokenId: AUTH.token.id,
          repoFullNames: updatedRepos,
        }),
      }),
    );
  });

  it("rejects a register body larger than 256 KiB before database access", async () => {
    const response = await registerAgent(
      request("/api/agent/register", {
        name: agentFixture!.name,
        repoFullNames: ["octopus/octopus"],
        machineInfo: { blob: "x".repeat(257 * 1024) },
      }),
    );

    expect(response.status).toBe(413);
    expect(localAgentCreate).not.toHaveBeenCalled();
    expect(localAgentUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects registration inputs exceeding the field caps", async () => {
    const oversizedBodies = [
      { name: "n".repeat(201), repoFullNames: ["octopus/octopus"] },
      {
        name: agentFixture!.name,
        repoFullNames: Array.from(
          { length: 501 },
          (_, i) => `octopus/repo-${i}`,
        ),
      },
      {
        name: agentFixture!.name,
        repoFullNames: [`octopus/${"r".repeat(300)}`],
      },
      {
        name: agentFixture!.name,
        repoFullNames: ["octopus/octopus"],
        capabilities: Array.from({ length: 51 }, () => "cap"),
      },
    ];

    for (const body of oversizedBodies) {
      const response = await registerAgent(
        request("/api/agent/register", body),
      );
      expect(response.status).toBe(400);
    }
    expect(localAgentCreate).not.toHaveBeenCalled();
    expect(localAgentUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects a non-object or oversized machineInfo", async () => {
    const invalidMachineInfos = [
      "darwin",
      [1, 2],
      { blob: "x".repeat(9 * 1024) },
    ];

    for (const machineInfo of invalidMachineInfos) {
      const response = await registerAgent(
        request("/api/agent/register", {
          name: agentFixture!.name,
          repoFullNames: ["octopus/octopus"],
          machineInfo,
        }),
      );
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain("machineInfo");
    }
    expect(localAgentCreate).not.toHaveBeenCalled();
    expect(localAgentUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects PostgreSQL-invalid registration strings before database access", async () => {
    const invalidBodies = [
      {
        name: "owner\u0000workstation",
        repoFullNames: ["octopus/octopus"],
      },
      {
        name: agentFixture!.name,
        repoFullNames: ["octopus/bad\u0000repo"],
      },
      {
        name: agentFixture!.name,
        repoFullNames: ["octopus/octopus"],
        capabilities: ["bad\uD800capability"],
      },
      {
        name: agentFixture!.name,
        repoFullNames: ["octopus/octopus"],
        machineInfo: { "bad\u0000key": "value" },
      },
    ];

    for (const body of invalidBodies) {
      const response = await registerAgent(
        request("/api/agent/register", body),
      );
      expect(response.status).toBe(400);
    }
    expect(localAgentCreate).not.toHaveBeenCalled();
    expect(localAgentUpdateMany).not.toHaveBeenCalled();
  });
});

describe("agent lifecycle ownership", () => {
  it("reports malformed disconnect JSON before database access", async () => {
    const response = await disconnectAgent(
      malformedRequest("/api/agent/disconnect"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request body" });
    expect(localAgentUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects PostgreSQL-invalid lifecycle agent IDs before database access", async () => {
    for (const agentId of ["agent\u0000id", "agent\uD800id"]) {
      const heartbeatResponse = await heartbeatAgent(
        request("/api/agent/heartbeat", { agentId }),
      );
      const disconnectResponse = await disconnectAgent(
        request("/api/agent/disconnect", { agentId }),
      );

      expect(heartbeatResponse.status).toBe(400);
      expect(disconnectResponse.status).toBe(400);
    }
    expect(localAgentUpdateMany).not.toHaveBeenCalled();
    expect(localAgentFindFirst).not.toHaveBeenCalled();
  });

  it("rejects heartbeat for an agent registered by another token", async () => {
    agentFixture = ownedAgent({ apiTokenId: "token_other" });
    localAgentUpdateManyResponses = [{ count: 0 }];

    const response = await heartbeatAgent(
      request("/api/agent/heartbeat", { agentId: agentFixture.id }),
    );

    expect(response.status).toBe(404);
    expect(localAgentUpdate).not.toHaveBeenCalled();
    expect(localAgentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: agentFixture.id,
          organizationId: AUTH.org.id,
          apiTokenId: AUTH.token.id,
        }),
      }),
    );
  });

  it("rejects heartbeat repository scopes containing non-string entries", async () => {
    const response = await heartbeatAgent(
      request("/api/agent/heartbeat", {
        agentId: agentFixture!.id,
        repoFullNames: ["octopus/octopus", 42],
      }),
    );

    expect(response.status).toBe(400);
    expect(localAgentUpdate).not.toHaveBeenCalled();
    expect(localAgentUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects PostgreSQL-invalid heartbeat repository strings", async () => {
    const response = await heartbeatAgent(
      request("/api/agent/heartbeat", {
        agentId: agentFixture!.id,
        repoFullNames: ["octopus/bad\u0000repo"],
      }),
    );

    expect(response.status).toBe(400);
    expect(localAgentUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects disconnect for an agent registered by another token", async () => {
    agentFixture = ownedAgent({ apiTokenId: "token_other" });
    localAgentUpdateManyResponses = [{ count: 0 }];

    const response = await disconnectAgent(
      request("/api/agent/disconnect", { agentId: agentFixture.id }),
    );

    expect(response.status).toBe(404);
    expect(localAgentUpdate).not.toHaveBeenCalled();
    expect(localAgentFindFirst).not.toHaveBeenCalled();
    expect(localAgentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: agentFixture.id,
          organizationId: AUTH.org.id,
          apiTokenId: AUTH.token.id,
        }),
      }),
    );
    expect(pubbyTrigger).not.toHaveBeenCalled();
  });

  it("disconnects an owned agent atomically and publishes it offline", async () => {
    localAgentUpdateManyResponses = [{ count: 1 }];
    localAgentFindFirstResponses = [{ name: agentFixture.name }];

    const response = await disconnectAgent(
      request("/api/agent/disconnect", { agentId: agentFixture!.id }),
    );

    expect(response.status).toBe(200);
    expect(localAgentUpdateMany).toHaveBeenCalledWith({
      where: {
        id: agentFixture.id,
        organizationId: AUTH.org.id,
        apiTokenId: AUTH.token.id,
      },
      data: { status: "offline" },
    });
    expect(localAgentFindFirst).toHaveBeenCalledWith({
      where: {
        id: agentFixture.id,
        organizationId: AUTH.org.id,
        apiTokenId: AUTH.token.id,
      },
      select: { name: true },
    });
    expect(pubbyTrigger).toHaveBeenCalledWith(
      `presence-org-${AUTH.org.id}`,
      "agent-offline",
      { agentId: agentFixture!.id, name: agentFixture!.name },
    );
  });

  it("rejects an oversized heartbeat repository scope", async () => {
    const response = await heartbeatAgent(
      request("/api/agent/heartbeat", {
        agentId: agentFixture!.id,
        repoFullNames: Array.from(
          { length: 501 },
          (_, i) => `octopus/repo-${i}`,
        ),
      }),
    );

    expect(response.status).toBe(400);
    expect(localAgentUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects a heartbeat body larger than 256 KiB", async () => {
    const response = await heartbeatAgent(
      request("/api/agent/heartbeat", {
        agentId: agentFixture!.id,
        padding: "x".repeat(257 * 1024),
      }),
    );

    expect(response.status).toBe(413);
    expect(localAgentUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects a disconnect body larger than 16 KiB", async () => {
    const response = await disconnectAgent(
      request("/api/agent/disconnect", {
        agentId: agentFixture!.id,
        padding: "x".repeat(17 * 1024),
      }),
    );

    expect(response.status).toBe(413);
    expect(localAgentUpdateMany).not.toHaveBeenCalled();
    expect(pubbyTrigger).not.toHaveBeenCalled();
  });
});

describe("agent search task ownership", () => {
  it("reports malformed claim JSON before database access", async () => {
    const response = await claimTask(
      malformedRequest("/api/agent/tasks/task_1/claim"),
      params(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request body" });
    expect(localAgentFindFirst).not.toHaveBeenCalled();
    expect(taskUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects PostgreSQL-invalid search agent IDs before database access", async () => {
    const claimResponse = await claimTask(
      request("/api/agent/tasks/task_1/claim", {
        agentId: "agent\uD800id",
      }),
      params(),
    );
    const pollResponse = await pollTasks(
      new Request("https://app.test/api/agent/tasks?agentId=agent%00id", {
        headers: { authorization: "Bearer oct_test" },
      }),
    );

    expect(claimResponse.status).toBe(400);
    expect(pollResponse.status).toBe(400);
    expect(localAgentFindFirst).not.toHaveBeenCalled();
    expect(taskFindMany).not.toHaveBeenCalled();
    expect(taskUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects PostgreSQL-invalid search task ids before database access", async () => {
    for (const id of ["task\u0000id", "task\uD800id"]) {
      const claimResponse = await claimTask(
        request("/api/agent/tasks/bad/claim", { agentId: "agent_owner" }),
        params(id),
      );
      const resultResponse = await submitResult(
        request("/api/agent/tasks/bad/result", {
          results: [],
          resultSummary: "safe",
        }),
        params(id),
      );

      expect(claimResponse.status).toBe(400);
      expect(resultResponse.status).toBe(400);
    }

    expect(localAgentFindFirst).not.toHaveBeenCalled();
    expect(taskFindFirst).not.toHaveBeenCalled();
    expect(taskUpdateMany).not.toHaveBeenCalled();
  });

  it("returns 409 for a result posted against an unclaimed task", async () => {
    taskFixture = claimedTask({
      status: "pending",
      agentId: null,
      agent: null,
    });
    taskFindFirstResponses = [searchTaskClaimProjection(taskFixture)];

    const response = await submitResult(
      request("/api/agent/tasks/task_1/result", {
        results: [],
        resultSummary: "safe",
      }),
      params(),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("Task not in claimed state");
    expect(taskUpdateMany).not.toHaveBeenCalled();
    expect(pubbyTrigger).not.toHaveBeenCalled();
  });

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
    agentFixture = ownedAgent({ apiTokenId: "token_other" });
    localAgentFindFirstResponses = [null];

    const response = await claimTask(
      request("/api/agent/tasks/task_1/claim", {
        agentId: agentFixture.id,
      }),
      params(),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Agent not found");
    expect(localAgentFindFirst).toHaveBeenCalledWith(
      {
        where: {
          id: agentFixture.id,
          organizationId: AUTH.org.id,
          apiTokenId: AUTH.token.id,
        },
        select: { repoFullNames: true },
      },
    );
    expect(taskUpdateMany).not.toHaveBeenCalled();
  });

  it("does not let an owned agent claim a task for an unwatched repository", async () => {
    agentFixture = ownedAgent({ repoFullNames: ["octopus/other"] });
    localAgentFindFirstResponses = [
      { repoFullNames: agentFixture.repoFullNames },
    ];
    taskUpdateManyResponses = [{ count: 0 }];

    const response = await claimTask(
      request("/api/agent/tasks/task_1/claim", {
        agentId: agentFixture.id,
      }),
      params(),
    );

    expect(response.status).toBe(409);
    expect(taskUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: taskFixture.id,
          organizationId: AUTH.org.id,
          status: "pending",
          repoFullName: { in: agentFixture.repoFullNames },
        },
      }),
    );
  });

  it("returns 409 when a claimed task changes state before the re-fetch", async () => {
    localAgentFindFirstResponses = [
      { repoFullNames: agentFixture!.repoFullNames },
    ];
    taskUpdateManyResponses = [{ count: 1 }];
    taskFindFirstResponses = [null];

    const response = await claimTask(
      request("/api/agent/tasks/task_1/claim", {
        agentId: agentFixture!.id,
      }),
      params(),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Task changed state before it could be returned",
    });
  });

  it("does not expose the queue through an agent owned by another token", async () => {
    agentFixture = ownedAgent({ apiTokenId: "token_other" });
    localAgentFindFirstResponses = [null];
    const response = await pollTasks(
      new Request(`https://app.test/api/agent/tasks?agentId=${agentFixture.id}`, {
        headers: { authorization: "Bearer oct_test" },
      }),
    );

    expect(response.status).toBe(404);
    expect(localAgentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: agentFixture.id,
          organizationId: AUTH.org.id,
          apiTokenId: AUTH.token.id,
        }),
      }),
    );
    expect(taskFindMany).not.toHaveBeenCalled();
  });

  it("rejects a result from a token that does not own the claiming agent", async () => {
    taskFixture = claimedTask({
      agent: { organizationId: AUTH.org.id, apiTokenId: "token_other" },
    });
    taskFindFirstResponses = [searchTaskClaimProjection(taskFixture)];

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
    taskFixture = claimedTask();
    taskFindFirstResponses = [searchTaskClaimProjection(taskFixture)];

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
    taskFixture = claimedTask();
    taskFindFirstResponses = [
      searchTaskClaimProjection(taskFixture),
      { status: "timeout" },
    ];
    taskUpdateManyResponses = [{ count: 0 }];

    const response = await submitResult(
      request("/api/agent/tasks/task_1/result", {
        results: [{ file: "safe.ts", line: 1, content: "safe" }],
        resultSummary: "safe",
      }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "timeout" });
    expect(taskUpdate).not.toHaveBeenCalled();
    expect(taskUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: taskFixture.id,
          organizationId: AUTH.org.id,
          agentId: taskFixture.agentId,
          status: "claimed",
        }),
      }),
    );
    expect(taskFindFirst).toHaveBeenLastCalledWith({
      where: {
        id: taskFixture.id,
        organizationId: AUTH.org.id,
        agentId: taskFixture.agentId,
        agent: {
          is: {
            organizationId: AUTH.org.id,
            apiTokenId: AUTH.token.id,
          },
        },
      },
      select: { status: true },
    });
    expect(pubbyTrigger).not.toHaveBeenCalled();
  });

  it("truncates a valid under-1MiB result to a whole-element array prefix", async () => {
    taskFixture = claimedTask();
    taskFindFirstResponses = [searchTaskClaimProjection(taskFixture)];
    taskUpdateManyResponses = [{ count: 1 }];
    const oversized = Array.from({ length: 80 }, (_, index) => ({
      file: `large-${index}.ts`,
      line: index + 1,
      content: "x".repeat(1024),
    }));

    const response = await submitResult(
      request("/api/agent/tasks/task_1/result", {
        results: oversized,
        resultSummary: "large result",
      }),
      params(),
    );

    expect(response.status).toBe(200);
    const transition = taskUpdateMany.mock.calls.at(-1)?.[0] as {
      data: { result: typeof oversized };
    };
    expect(Array.isArray(transition.data.result)).toBeTrue();
    expect(transition.data.result.length).toBeGreaterThan(0);
    expect(transition.data.result.length).toBeLessThan(oversized.length);
    expect(transition.data.result).toEqual(
      oversized.slice(0, transition.data.result.length),
    );
    expect(
      new TextEncoder().encode(JSON.stringify(transition.data.result))
        .byteLength,
    ).toBeLessThanOrEqual(50 * 1024);
  });

  it("preserves an oversized result's object root while truncating entries", async () => {
    taskFixture = claimedTask();
    taskFindFirstResponses = [searchTaskClaimProjection(taskFixture)];
    taskUpdateManyResponses = [{ count: 1 }];
    const oversized = Object.fromEntries(
      Array.from({ length: 80 }, (_, index) => [
        `match_${index}`,
        { file: `large-${index}.ts`, content: "x".repeat(1024) },
      ]),
    );

    const response = await submitResult(
      request("/api/agent/tasks/task_1/result", {
        results: oversized,
        resultSummary: "large object result",
      }),
      params(),
    );

    expect(response.status).toBe(200);
    const transition = taskUpdateMany.mock.calls.at(-1)?.[0] as {
      data: { result: Record<string, unknown> };
    };
    expect(Array.isArray(transition.data.result)).toBeFalse();
    const storedKeys = Object.keys(transition.data.result);
    expect(storedKeys.length).toBeGreaterThan(0);
    expect(storedKeys.length).toBeLessThan(Object.keys(oversized).length);
    expect(transition.data.result).toEqual(
      Object.fromEntries(Object.entries(oversized).slice(0, storedKeys.length)),
    );
    expect(
      new TextEncoder().encode(JSON.stringify(transition.data.result))
        .byteLength,
    ).toBeLessThanOrEqual(50 * 1024);
  });

  it("sanitizes PostgreSQL-incompatible strings throughout stored results", async () => {
    taskFixture = claimedTask();
    taskFindFirstResponses = [searchTaskClaimProjection(taskFixture)];
    taskUpdateManyResponses = [{ count: 1 }];

    const response = await submitResult(
      request("/api/agent/tasks/task_1/result", {
        results: {
          "bad\u0000key": ["high\uD800end", "nul\u0000end", { low: "\uDC00" }],
        },
        resultSummary: "summary\u0000\uD800",
      }),
      params(),
    );

    expect(response.status).toBe(200);
    const transition = taskUpdateMany.mock.calls.at(-1)?.[0] as {
      data: { result: unknown; resultSummary: string };
    };
    expect(transition.data.result).toEqual({
      "bad�key": ["high�end", "nul�end", { low: "�" }],
    });
    expect(transition.data.resultSummary).toBe("summary��");
  });

  it("stores an error-only result with the explicit database-null sentinel", async () => {
    taskFixture = claimedTask();
    taskFindFirstResponses = [searchTaskClaimProjection(taskFixture)];
    taskUpdateManyResponses = [{ count: 1 }];

    const response = await submitResult(
      request("/api/agent/tasks/task_1/result", {
        errorMessage: "agent failed",
      }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "failed" });
    expect(taskUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          result: PRISMA_DB_NULL,
          errorMessage: "agent failed",
        }),
      }),
    );
  });

  it("terminalizes an owned result larger than 1 MiB and publishes once", async () => {
    taskFixture = claimedTask();
    taskFindFirstResponses = [searchTaskClaimProjection(taskFixture)];
    taskUpdateManyResponses = [{ count: 1 }];
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
    expect(await response.json()).toEqual({
      error: "Agent result exceeded the 1 MiB transport limit",
      status: "failed",
    });
    expect(taskFindFirst).toHaveBeenCalledWith({
      where: { id: taskFixture.id, organizationId: AUTH.org.id },
      select: {
        agentId: true,
        searchType: true,
        status: true,
        agent: {
          select: { organizationId: true, apiTokenId: true },
        },
      },
    });
    expect(taskUpdateMany).toHaveBeenCalledWith({
      where: {
        id: taskFixture.id,
        organizationId: AUTH.org.id,
        agentId: taskFixture.agentId,
        status: "claimed",
        agent: {
          is: {
            organizationId: AUTH.org.id,
            apiTokenId: AUTH.token.id,
          },
        },
      },
      data: {
        status: "failed",
        result: PRISMA_DB_NULL,
        resultSummary: null,
        errorMessage: "Agent result exceeded the 1 MiB transport limit",
        completedAt: expect.any(Date),
      },
    });
    expect(pubbyTrigger).toHaveBeenCalledTimes(1);
    expect(pubbyTrigger).toHaveBeenCalledWith(
      `private-agent-org-${AUTH.org.id}`,
      "agent-search-complete",
      { taskId: taskFixture.id, status: "failed" },
    );
  });

  it("rejects another token's oversized result without mutation", async () => {
    taskFixture = claimedTask({
      agent: { organizationId: AUTH.org.id, apiTokenId: "token_other" },
    });
    taskFindFirstResponses = [searchTaskClaimProjection(taskFixture)];
    const serialized = JSON.stringify({
      results: { content: "x".repeat(1025 * 1024) },
    });

    const response = await submitResult(
      new Request("https://app.test/api/agent/tasks/task_1/result", {
        method: "POST",
        headers: {
          authorization: "Bearer oct_test",
          "content-type": "application/json",
          "content-length": String(
            new TextEncoder().encode(serialized).length,
          ),
        },
        body: serialized,
      }),
      params(),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Task is claimed by a different agent",
    });
    expect(taskUpdateMany).not.toHaveBeenCalled();
    expect(pubbyTrigger).not.toHaveBeenCalled();
  });

  it("returns a concurrent timeout when oversized terminalization loses the race", async () => {
    taskFixture = claimedTask();
    taskFindFirstResponses = [
      searchTaskClaimProjection(taskFixture),
      { status: "timeout" },
    ];
    taskUpdateManyResponses = [{ count: 0 }];
    const serialized = JSON.stringify({
      results: { content: "x".repeat(1025 * 1024) },
    });

    const response = await submitResult(
      new Request("https://app.test/api/agent/tasks/task_1/result", {
        method: "POST",
        headers: {
          authorization: "Bearer oct_test",
          "content-type": "application/json",
          "content-length": String(
            new TextEncoder().encode(serialized).length,
          ),
        },
        body: serialized,
      }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "timeout" });
    expect(taskUpdateMany).toHaveBeenCalledTimes(1);
    expect(taskFindFirst).toHaveBeenCalledTimes(2);
    expect(pubbyTrigger).not.toHaveBeenCalled();
  });

  it("returns an already-failed retry without reading or publishing", async () => {
    taskFixture = claimedTask({ status: "failed" });
    taskFindFirstResponses = [searchTaskClaimProjection(taskFixture)];

    const response = await submitResult(
      request("/api/agent/tasks/task_1/result", {
        results: { content: "retry" },
      }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "failed" });
    expect(taskUpdateMany).not.toHaveBeenCalled();
    expect(pubbyTrigger).not.toHaveBeenCalled();
  });

  it("accepts a multibyte answer summary below 1 MiB and applies its character cap", async () => {
    taskFixture = claimedTask({ searchType: "answer" });
    taskFindFirstResponses = [searchTaskClaimProjection(taskFixture)];
    taskUpdateManyResponses = [{ count: 1 }];
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
    const transition = taskUpdateMany.mock.calls.at(-1)?.[0] as {
      data: { resultSummary: string };
    };
    expect(transition.data.resultSummary).toBe(
      summary.slice(0, 100 * 1024),
    );
    expect(transition.data.resultSummary.length).toBe(100 * 1024);
  });

  it("rejects deeply nested valid JSON without throwing or transitioning the task", async () => {
    taskFixture = claimedTask();
    taskFindFirstResponses = [searchTaskClaimProjection(taskFixture)];
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

  it("rejects a claim body larger than 16 KiB", async () => {
    const response = await claimTask(
      request("/api/agent/tasks/task_1/claim", {
        agentId: "x".repeat(17 * 1024),
      }),
      params(),
    );

    expect(response.status).toBe(413);
    expect(localAgentFindFirst).not.toHaveBeenCalled();
    expect(taskUpdateMany).not.toHaveBeenCalled();
  });

  it("strips a split surrogate pair when capping an answer summary", async () => {
    taskFixture = claimedTask({ searchType: "answer" });
    taskFindFirstResponses = [searchTaskClaimProjection(taskFixture)];
    taskUpdateManyResponses = [{ count: 1 }];
    const summary = `x${"😀".repeat(60_000)}`;

    const response = await submitResult(
      request("/api/agent/tasks/task_1/result", {
        results: [],
        resultSummary: summary,
      }),
      params(),
    );

    expect(response.status).toBe(200);
    const transition = taskUpdateMany.mock.calls.at(-1)?.[0] as {
      data: { resultSummary: string };
    };
    expect(transition.data.resultSummary).toBe(
      summary.slice(0, 100 * 1024 - 1),
    );
    expect(transition.data.resultSummary.endsWith("😀")).toBeTrue();
  });

  it("strips a split surrogate pair when capping an error message", async () => {
    taskFixture = claimedTask();
    taskFindFirstResponses = [searchTaskClaimProjection(taskFixture)];
    taskUpdateManyResponses = [{ count: 1 }];
    const errorMessage = `x${"😀".repeat(600)}`;

    const response = await submitResult(
      request("/api/agent/tasks/task_1/result", {
        results: [],
        errorMessage,
      }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "failed" });
    const transition = taskUpdateMany.mock.calls.at(-1)?.[0] as {
      data: { errorMessage: string };
    };
    expect(transition.data.errorMessage).toBe(errorMessage.slice(0, 999));
    expect(transition.data.errorMessage.endsWith("😀")).toBeTrue();
  });

  it("keeps an emoji-heavy truncated string result well-formed", async () => {
    taskFixture = claimedTask();
    taskFindFirstResponses = [searchTaskClaimProjection(taskFixture)];
    taskUpdateManyResponses = [{ count: 1 }];

    const response = await submitResult(
      request("/api/agent/tasks/task_1/result", {
        results: `xxx${"😀".repeat(20_000)}`,
        resultSummary: "emoji",
      }),
      params(),
    );

    expect(response.status).toBe(200);
    const transition = taskUpdateMany.mock.calls.at(-1)?.[0] as {
      data: { result: string };
    };
    expect(typeof transition.data.result).toBe("string");
    expect(transition.data.result).not.toMatch(/[\uD800-\uDBFF]$/);
    expect(
      new TextEncoder().encode(JSON.stringify(transition.data.result))
        .byteLength,
    ).toBeLessThanOrEqual(50 * 1024);
  });

  it("accepts the existing result payload without agentId for its owning token", async () => {
    taskFixture = claimedTask();
    taskFindFirstResponses = [searchTaskClaimProjection(taskFixture)];
    taskUpdateManyResponses = [{ count: 1 }];
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
    expect(taskUpdateMany).toHaveBeenCalledWith({
      where: {
        id: taskFixture.id,
        organizationId: AUTH.org.id,
        agentId: taskFixture.agentId,
        status: "claimed",
        agent: {
          is: {
            organizationId: AUTH.org.id,
            apiTokenId: AUTH.token.id,
          },
        },
      },
      data: {
        status: "completed",
        result: results,
        resultSummary: "one safe match",
        errorMessage: null,
        completedAt: expect.any(Date),
      },
    });
    expect(taskUpdate).not.toHaveBeenCalled();
    expect(pubbyTrigger).toHaveBeenCalledWith(
      `private-agent-org-${AUTH.org.id}`,
      "agent-search-complete",
      { taskId: taskFixture.id, status: "completed" },
    );
  });
});

describe("agent LLM task ownership", () => {
  it("returns 409 for an LLM completion posted against an unclaimed task", async () => {
    llmTaskFixture = claimedLlmTask({
      status: "pending",
      agentId: null,
      agent: null,
    });
    llmTaskFindFirstResponses = [llmTaskClaimProjection(llmTaskFixture)];

    const response = await completeLlmTask(
      request("/api/agent/llm-tasks/llm_task_1/complete", {
        agentId: "agent_owner",
        text: "done",
      }),
      params("llm_task_1"),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Task not in claimed state",
    });
    expect(llmTaskUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects PostgreSQL-invalid LLM agent IDs before database access", async () => {
    const completeResponse = await completeLlmTask(
      request("/api/agent/llm-tasks/llm_task_1/complete", {
        agentId: "agent\uD800id",
        text: "safe",
      }),
      params("llm_task_1"),
    );
    const pollResponse = await pollLlmTasks(
      new Request("https://app.test/api/agent/llm-tasks?agentId=agent%00id", {
        headers: { authorization: "Bearer oct_test" },
      }),
    );

    expect(completeResponse.status).toBe(400);
    expect(pollResponse.status).toBe(400);
    expect(localAgentFindFirst).not.toHaveBeenCalled();
    expect(llmTaskFindFirst).not.toHaveBeenCalled();
    expect(llmTaskFindMany).not.toHaveBeenCalled();
    expect(llmTaskUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects PostgreSQL-invalid LLM task ids before database access", async () => {
    for (const id of ["llm\u0000task", "llm\uDC00task"]) {
      const response = await completeLlmTask(
        request("/api/agent/llm-tasks/bad/complete", {
          agentId: "agent_owner",
          text: "done",
        }),
        params(id),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid task id" });
    }
    expect(llmTaskFindFirst).not.toHaveBeenCalled();
    expect(llmTaskUpdateMany).not.toHaveBeenCalled();
  });

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
    agentFixture = ownedAgent({ apiTokenId: "token_other" });
    localAgentFindFirstResponses = [null];

    const response = await pollLlmTasks(
      new Request(
        `https://app.test/api/agent/llm-tasks?agentId=${agentFixture.id}`,
        { headers: { authorization: "Bearer oct_test" } },
      ),
    );

    expect(response.status).toBe(404);
    expect(llmTaskFindMany).not.toHaveBeenCalled();
    expect(llmTaskUpdateMany).not.toHaveBeenCalled();
  });

  it("keeps the LLM claim transition and re-fetch scoped to the organization", async () => {
    llmTaskFixture = claimedLlmTask({
      status: "pending",
      agentId: null,
      agent: null,
      claimedAt: null,
    });
    localAgentFindFirstResponses = [agentFixture];
    llmTaskUpdateManyResponses = [{ count: 0 }, { count: 1 }];
    llmTaskFindManyResponses = [
      [{ id: llmTaskFixture.id }],
      [
        {
          id: llmTaskFixture.id,
          modelId: llmTaskFixture.modelId,
          system: llmTaskFixture.system,
          messages: llmTaskFixture.messages,
          maxTokens: llmTaskFixture.maxTokens,
          createdAt: llmTaskFixture.createdAt,
        },
      ],
    ];

    const response = await pollLlmTasks(
      new Request(
        `https://app.test/api/agent/llm-tasks?agentId=${agentFixture!.id}`,
        { headers: { authorization: "Bearer oct_test" } },
      ),
    );

    expect(response.status).toBe(200);
    const claimTransition = llmTaskUpdateMany.mock.calls.find(
      ([input]) => input.data.agentId === agentFixture!.id,
    )?.[0];
    expect(claimTransition).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: [llmTaskFixture.id] },
          organizationId: AUTH.org.id,
          status: "pending",
        }),
      }),
    );

    const claimedFetch = llmTaskFindMany.mock.calls.find(
      ([input]) => input.where?.agentId === agentFixture!.id,
    )?.[0];
    expect(claimedFetch).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: [llmTaskFixture.id] },
          organizationId: AUTH.org.id,
          agentId: agentFixture!.id,
          status: "claimed",
        }),
      }),
    );
  });

  it("rejects completion when the stored claimant belongs to another token", async () => {
    llmTaskFixture = claimedLlmTask({
      agent: { organizationId: AUTH.org.id, apiTokenId: "token_other" },
    });
    llmTaskFindFirstResponses = [llmTaskClaimProjection(llmTaskFixture)];

    const response = await completeLlmTask(
      request("/api/agent/llm-tasks/llm_task_1/complete", {
        agentId: llmTaskFixture.agentId,
        text: "untrusted completion",
      }),
      params(llmTaskFixture.id),
    );

    expect([403, 404]).toContain(response.status);
    expect(llmTaskUpdateMany).not.toHaveBeenCalled();
  });

  it("atomically completes through the full org, agent, and token boundary", async () => {
    llmTaskFixture = claimedLlmTask();
    llmTaskFindFirstResponses = [llmTaskClaimProjection(llmTaskFixture)];
    llmTaskUpdateManyResponses = [{ count: 1 }];

    const response = await completeLlmTask(
      request("/api/agent/llm-tasks/llm_task_1/complete", {
        agentId: llmTaskFixture.agentId,
        text: "trusted completion",
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
      params(llmTaskFixture.id),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "completed" });
    expect(llmTaskUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: llmTaskFixture.id,
          organizationId: AUTH.org.id,
          agentId: llmTaskFixture.agentId,
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
  });

  it("sanitizes PostgreSQL-incompatible LLM result text", async () => {
    llmTaskFixture = claimedLlmTask();
    llmTaskFindFirstResponses = [llmTaskClaimProjection(llmTaskFixture)];
    llmTaskUpdateManyResponses = [{ count: 1 }];

    const response = await completeLlmTask(
      request("/api/agent/llm-tasks/llm_task_1/complete", {
        agentId: llmTaskFixture.agentId,
        text: "safe\u0000\uD800",
      }),
      params(llmTaskFixture.id),
    );

    expect(response.status).toBe(200);
    const transition = llmTaskUpdateMany.mock.calls.at(-1)?.[0] as {
      data: { resultText: string };
    };
    expect(transition.data.resultText).toBe("safe��");
  });

  it("strips a split surrogate pair from a capped LLM error message", async () => {
    llmTaskFixture = claimedLlmTask();
    llmTaskFindFirstResponses = [llmTaskClaimProjection(llmTaskFixture)];
    llmTaskUpdateManyResponses = [{ count: 1 }];
    const error = `x${"😀".repeat(600)}`;

    const response = await completeLlmTask(
      request("/api/agent/llm-tasks/llm_task_1/complete", {
        agentId: llmTaskFixture.agentId,
        error,
      }),
      params(llmTaskFixture.id),
    );

    expect(response.status).toBe(200);
    const transition = llmTaskUpdateMany.mock.calls.at(-1)?.[0] as {
      data: { errorMessage: string };
    };
    expect(transition.data.errorMessage).toBe(error.slice(0, 999));
    expect(transition.data.errorMessage.endsWith("😀")).toBeTrue();
  });

  it("truncates multibyte result text on a complete UTF-8 code-point boundary", async () => {
    llmTaskFixture = claimedLlmTask();
    llmTaskFindFirstResponses = [llmTaskClaimProjection(llmTaskFixture)];
    llmTaskUpdateManyResponses = [{ count: 1 }];
    const text = `a${"😀".repeat(600_000)}`;

    const response = await completeLlmTask(
      request("/api/agent/llm-tasks/llm_task_1/complete", {
        agentId: llmTaskFixture.agentId,
        text,
      }),
      params(llmTaskFixture.id),
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
