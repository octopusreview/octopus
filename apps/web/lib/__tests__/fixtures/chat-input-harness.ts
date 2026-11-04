import { mock } from "bun:test";
import assert from "node:assert/strict";

let authenticated = true;
let members = 0;
let conversations = 0;
let writes = 0;
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({ headers: async () => new Headers() }));
mock.module("@/lib/auth", () => ({ auth: { api: { getSession: async () => authenticated ? { user: { id: "user1" } } : null } } }));
mock.module("@octopus/db", () => ({ prisma: {
  organizationMember: { findFirst: async () => { members++; return { user: { bannedAt: null }, organization: { bannedAt: null } }; } },
  chatConversation: { findFirst: async () => { conversations++; return null; }, create: async () => { writes++; throw new Error("unexpected write"); } },
} }));
const noop = () => undefined;
const modules: Record<string, Record<string, unknown>> = {
  embeddings: { createEmbeddings: noop },
  qdrant: { searchCodeChunksAcrossRepos: noop, searchKnowledgeChunks: noop, searchReviewChunks: noop, searchChatChunks: noop, searchDiagramChunks: noop, ensureChatCollection: noop, upsertChatChunk: noop },
  "ai-usage": { logAiUsage: noop }, reranker: { rerankDocuments: noop }, pubby: { pubby: {} },
  "chat-queue-processor": { processNextInQueue: noop }, cost: { getOrgSpendLimitStatus: noop },
  "sparse-vector": { generateSparseVector: noop }, "agent-search": { requestAgentSearch: noop, findClaudeAgent: noop, requestAgentAnswer: noop },
  "ai-client": { getReviewModel: noop }, "chat-stream": { streamChat: noop },
  "chat-guard": { chatScopeGuardEnabled: noop, checkChatScope: noop, checkFreeChatDailyCap: noop, dailyCapMessage: noop, OUT_OF_SCOPE_MESSAGE: "" },
};
for (const [name, exports] of Object.entries(modules)) mock.module(`@/lib/${name}`, () => exports);
const { POST } = await import("../../../app/api/chat/route");
const request = (value: unknown) => new Request("https://example.test/api/chat", { method: "POST", body: JSON.stringify(value) });
const invalid = [null, [], {}, { message: 1, orgId: "org" }, { message: "ok", orgId: {} },
  { message: "ok", orgId: "org", conversationId: {} }, { message: "ok", orgId: "org", repoContext: [] },
  { message: "bad\0text", orgId: "org" }, { message: "ok", orgId: "org\0" },
  { message: "ok", orgId: "org", conversationId: "bad\0id" }, { message: "ok", orgId: "org", repoContext: "bad\0repo" }];
for (const body of invalid) assert.equal((await POST(request(body))).status, 400);
assert.equal((await POST(new Request("https://example.test/api/chat", { method: "POST", body: "{" }))).status, 400);
assert.equal(members, 0); assert.equal(conversations, 0); assert.equal(writes, 0);
authenticated = false;
assert.equal((await POST(request({}))).status, 401);
authenticated = true;
assert.equal((await POST(request({ message: "hello", orgId: "org", conversationId: "missing", repoContext: null }))).status, 404);
assert.equal(members, 1); assert.equal(conversations, 1); assert.equal(writes, 0);
