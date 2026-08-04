import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import { createHash, randomUUID } from "crypto";

const RUN_DB_TESTS = process.env.RUN_AGENT_TASK_DB_TESTS === "1";

function assertDedicatedTestDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "RUN_AGENT_TASK_DB_TESTS=1 requires DATABASE_URL for a dedicated test database",
    );
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }

  if (!/(^|[-_])test($|[-_])/.test(databaseName.toLowerCase())) {
    throw new Error(
      `Refusing to run agent task DB tests against non-test database "${databaseName}"`,
    );
  }
}

if (RUN_DB_TESTS) {
  assertDedicatedTestDatabase();
}

const pubbyTrigger = mock(() => Promise.resolve());

if (RUN_DB_TESTS) {
  mock.module("server-only", () => ({}));
  mock.module("@/lib/pubby", () => ({
    pubby: { trigger: pubbyTrigger },
  }));
}

type DbModule = typeof import("@octopus/db");
type ResultRoute = typeof import("@/app/api/agent/tasks/[id]/result/route");

let prisma: DbModule["prisma"];
let postResult: ResultRoute["POST"];

if (RUN_DB_TESTS) {
  ({ prisma } = await import("@octopus/db"));
  ({ POST: postResult } = await import(
    "@/app/api/agent/tasks/[id]/result/route"
  ));
}

const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const fixtureId = randomUUID().replaceAll("-", "");
const userId = `agent_db_user_${fixtureId}`;
const organizationId = `agent_db_org_${fixtureId}`;
const agentId = `agent_db_agent_${fixtureId}`;
const repoFullName = `octopusreview/agent-db-${fixtureId}`;
const ownerToken = `oct_${randomUUID().replaceAll("-", "")}`;
const otherToken = `oct_${randomUUID().replaceAll("-", "")}`;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function resultRequest(
  taskId: string,
  token: string,
  body: Record<string, unknown>,
): Request {
  return new Request(
    `http://localhost/api/agent/tasks/${taskId}/result`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

async function submitResult(
  taskId: string,
  token: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return postResult(resultRequest(taskId, token, body), {
    params: Promise.resolve({ id: taskId }),
  });
}

async function createClaimedTask(label: string) {
  return prisma.agentSearchTask.create({
    data: {
      id: `agent_db_task_${label}_${randomUUID().replaceAll("-", "")}`,
      query: `integration query ${label}`,
      repoFullName,
      organizationId,
      agentId,
      status: "claimed",
      claimedAt: new Date(),
    },
  });
}

describeDb("agent task result route with PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        name: "Agent DB Test User",
        email: `${userId}@example.test`,
      },
    });
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Agent Task DB Test",
        slug: `agent-task-db-${fixtureId}`,
      },
    });

    const [ownerApiToken] = await Promise.all([
      prisma.orgApiToken.create({
        data: {
          name: "owner agent token",
          tokenHash: sha256(ownerToken),
          tokenPrefix: `${ownerToken.slice(0, 8)}...`,
          organizationId,
          createdById: userId,
        },
      }),
      prisma.orgApiToken.create({
        data: {
          name: "other agent token",
          tokenHash: sha256(otherToken),
          tokenPrefix: `${otherToken.slice(0, 8)}...`,
          organizationId,
          createdById: userId,
        },
      }),
    ]);

    await prisma.localAgent.create({
      data: {
        id: agentId,
        name: `agent-db-${fixtureId}`,
        status: "online",
        repoFullNames: [repoFullName],
        capabilities: ["grep"],
        organizationId,
        apiTokenId: ownerApiToken.id,
      },
    });
  });

  afterAll(async () => {
    try {
      await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("completes an owned task through real auth and nested relation filters", async () => {
    const task = await createClaimedTask("owner");
    const results = { files: ["apps/web/app/api/agent/tasks/route.ts"] };

    const response = await submitResult(task.id, ownerToken, {
      agentId,
      results,
      resultSummary: "owner result",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "completed" });

    const stored = await prisma.agentSearchTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    expect(stored.status).toBe("completed");
    expect(stored.result).toEqual(results);
    expect(stored.resultSummary).toBe("owner result");
    expect(stored.completedAt).toBeInstanceOf(Date);
  });

  it("does not let another token in the organization mutate the claimed task", async () => {
    const task = await createClaimedTask("other-token");

    const response = await submitResult(task.id, otherToken, {
      agentId,
      results: { files: ["should-not-persist.ts"] },
    });

    expect(response.status).toBe(403);
    const stored = await prisma.agentSearchTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    expect(stored.status).toBe("claimed");
    expect(stored.result).toBeNull();
    expect(stored.completedAt).toBeNull();
  });

  it("terminally fails an owned task when its request body is too large", async () => {
    const task = await createClaimedTask("oversized");
    const oversizedBody = {
      agentId,
      results: { output: "x".repeat(1024 * 1024) },
    };

    const response = await submitResult(task.id, ownerToken, oversizedBody);

    expect(response.status).toBe(413);
    const responseBody = (await response.json()) as {
      error: string;
      status: string;
    };
    expect(responseBody.status).toBe("failed");
    expect(responseBody.error.length).toBeGreaterThan(0);
    const stored = await prisma.agentSearchTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    expect(stored.status).toBe("failed");
    expect(stored.errorMessage).toBe(responseBody.error);
    expect(stored.result).toEqual({
      truncated: true,
      reason: "transport_limit",
      limitBytes: 1024 * 1024,
    });
    expect(stored.resultSummary).toBeNull();
    expect(stored.completedAt).toBeInstanceOf(Date);
  });

  it("allows only one guarded terminal update when results race", async () => {
    const task = await createClaimedTask("race");
    pubbyTrigger.mockClear();

    const responses = await Promise.all([
      submitResult(task.id, ownerToken, {
        agentId,
        results: { winner: "first" },
      }),
      submitResult(task.id, ownerToken, {
        agentId,
        results: { winner: "second" },
      }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(
      await Promise.all(responses.map((response) => response.json())),
    ).toEqual([
      { ok: true, status: "completed" },
      { ok: true, status: "completed" },
    ]);
    expect(pubbyTrigger).toHaveBeenCalledTimes(1);

    const stored = await prisma.agentSearchTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    expect(stored.status).toBe("completed");
    expect(["first", "second"]).toContain(
      (stored.result as { winner: string }).winner,
    );

    const replay = await submitResult(task.id, ownerToken, {
      agentId,
      results: { winner: "replay" },
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ ok: true, status: "completed" });
    const afterReplay = await prisma.agentSearchTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    expect(afterReplay.result).toEqual(stored.result);
  });
});
