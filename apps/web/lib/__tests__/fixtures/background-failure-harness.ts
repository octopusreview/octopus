import { mock } from "bun:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import type { ErrorEvent } from "@sentry/nextjs";
import { scrubEvent } from "../../sentry-scrub";

mock.module("server-only", () => ({}));
const events: ErrorEvent[] = [];
const rawEvents: ErrorEvent[] = [];
let telemetryThrows = false;
mock.module("@sentry/nextjs", () => ({ captureEvent: (event: ErrorEvent) => {
  if (telemetryThrows) throw new Error("telemetry unavailable");
  rawEvents.push(event);
  events.push(scrubEvent({ ...event, request: { headers: { authorization: "secret" } }, user: { email: "private@example.test" },
    extra: { source: "customer source" }, breadcrumbs: [{ message: "secret prompt" }], transaction: "private route" }));
  return "e".repeat(32);
} }));
let byok = false;
let adapterOrg: Record<string, string> = {};
const usedKeys: string[] = [];
globalThis.fetch = (() => { throw new Error("Unexpected network access"); }) as typeof fetch;
let failure: unknown = new Error("terminated", { cause: Object.assign(new Error("private body"), { code: "UND_ERR_SOCKET", headers: { authorization: "secret" } }) });
mock.module("@octopus/db", () => ({ prisma: {
  availableModel: { findMany: async () => [] },
  organization: { findUnique: async () => ({ anthropicApiKey: byok ? "secret" : null, ...adapterOrg }) },
} }));
mock.module("@/lib/crypto", () => ({ decryptStringMaybeLegacy: (value: string) => value }));
mock.module("openai", () => ({ default: class {
  constructor(options: { apiKey: string }) { usedKeys.push(options.apiKey); }
  chat = { completions: { create: async () => {
    if (failure) throw failure;
    return { choices: [{ finish_reason: "stop", message: { content: "complete" } }] };
  } } };
} }));
mock.module("@anthropic-ai/sdk", () => ({ default: class {
  static APIUserAbortError = class extends Error {};
  constructor(options: { apiKey: string }) { usedKeys.push(options.apiKey); }
  messages = { stream: () => ({ finalMessage: async () => {
    if (failure) throw failure;
    return { content: [{ type: "text", text: "complete" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
  } }) };
} }));
const { acpProvider } = await import("../../providers/acp");
const { opencodeProvider } = await import("../../providers/opencode");
const { claudeCodeProvider } = await import("../../providers/claude-code");
const adapters = { acp: acpProvider, opencode: opencodeProvider, "claude-code": claudeCodeProvider };
mock.module("@/lib/providers", () => ({ getProvider: (name: string) => adapters[name as keyof typeof adapters]
  ?? { create: async () => { if (failure) throw failure; return { text: "complete" }; } } }));
const { createAiMessage } = await import("../../ai-router");
const { reportBackgroundFailure } = await import("../../background-failure");
const { AiProviderFailure, classifyFailure, providerKeyOwner, safeErrorDetails } = await import("../../provider-failure");
for (const operation of ["review_input", "repository_tree"] as const) {
  reportBackgroundFailure(new Error("private-url-and-content"), { stage: "preparation", preparationOperation: operation });
  assert.equal(events.at(-1)?.tags?.preparation_operation, operation);
  assert.ok(!JSON.stringify(events.at(-1)).includes("private-url-and-content"));
}
reportBackgroundFailure(new Error("private"), { stage: "generation", preparationOperation: "review_input" });
assert.equal(events.at(-1)?.tags?.preparation_operation, undefined);
assert.equal(scrubEvent({ tags: { error_boundary: "background", preparation_operation: "private-url" } }).tags?.preparation_operation, undefined);
assert.equal(scrubEvent({ tags: { error_boundary: "background", indexing_deadline: "private-url" } }).tags?.indexing_deadline, undefined);
assert.equal(scrubEvent({ tags: { error_boundary: "background", failure_stage: "indexing", indexing_deadline: "worker_25m", indexing_last_milestone: "private-url" } }).tags?.indexing_last_milestone, undefined);
assert.equal(scrubEvent({ tags: { error_boundary: "background", failure_stage: "indexing", indexing_deadline: "worker_25m", indexing_last_milestone: "fetching_files" } }).tags?.indexing_last_milestone, "fetching_files");
assert.equal(scrubEvent({ tags: { error_boundary: "background", failure_stage: "indexing", indexing_last_milestone: "fetching_files" } }).tags?.indexing_last_milestone, undefined);
assert.equal(scrubEvent({ tags: { error_boundary: "background", failure_stage: "generation", indexing_deadline: "worker_25m", indexing_last_milestone: "fetching_files" } }).tags?.indexing_last_milestone, undefined);
reportBackgroundFailure(new DOMException("private", "TimeoutError"), { stage: "indexing", indexingDeadline: true });
assert.equal(events.at(-1)?.tags?.indexing_deadline, "worker_25m");
reportBackgroundFailure(new DOMException("private", "TimeoutError"), { stage: "preparation", indexingDeadline: true });
assert.equal(events.at(-1)?.tags?.indexing_deadline, undefined);
events.length = 0;
const originalError = console.error;
const errorLogs: string[] = [];
console.error = (...args: unknown[]) => { errorLogs.push(inspect(args)); };
const request = { model: "claude-fixture", maxTokens: 10, messages: [{ role: "user" as const, content: "secret prompt" }] };
const context = { stage: "generation" as const, attemptId: "attempt-1", pullRequestId: "pr-1", headSha: "a".repeat(40) };
async function caught() {
  try { await createAiMessage(request, "org"); assert.fail("expected provider failure"); }
  catch (error) { assert.ok(error instanceof AiProviderFailure); return error; }
}
let error = await caught();
reportBackgroundFailure(error, context);
assert.equal(events.length, 1);
assert.equal(events[0].tags?.failure_code, "STREAM_TERMINATED");
assert.equal(events[0].contexts?.background_failure?.attemptId, "attempt-1");
assert.equal(events[0].contexts?.background_failure?.model, "claude-fixture");
assert.equal(events[0].tags?.failure_owner, "unknown", "interruption is not a proven provider outage");
reportBackgroundFailure(error, context);
assert.equal(events.length, 1, "outer handler cannot duplicate the same failure");
const privateMarker = "synthetic-credential-and-prompt";
const requestIdMarker = "req_secretvalue123";
failure = Object.assign(new Error(`Provider response: ${privateMarker}`, { cause: Object.assign(new Error(privateMarker), { code: "ECONNRESET", requestID: requestIdMarker }) }), { status: 401, request_id: requestIdMarker });
const logStart = errorLogs.length;
const sanitized = await caught();
assert.equal(sanitized.details.status, 401);
assert.deepEqual(sanitized.details, { name: "Error", status: 401, code: "ECONNRESET" });
assert.match(sanitized.message, /HTTP 401/);
reportBackgroundFailure(sanitized, context);
reportBackgroundFailure(failure, context);
for (const output of [sanitized.message, sanitized.stack ?? "", inspect(sanitized), JSON.stringify(sanitized), errorLogs.slice(logStart).join("\n")]) {
  assert.ok(!output.includes(privateMarker), "provider response must not reach errors or logs");
  assert.ok(!output.includes(requestIdMarker), "provider request ID must not reach errors or logs");
}
for (const event of rawEvents.slice(-2)) {
  assert.ok(!JSON.stringify(event).includes(requestIdMarker));
  assert.equal(event.contexts?.background_failure?.status, 401);
  assert.equal(event.contexts?.background_failure?.code, "ECONNRESET");
}
for (const status of [401, 402, 403, 429, 503, undefined]) {
  for (byok of [false, true]) {
    failure = Object.assign(new Error("private payload"), { status, code: status === undefined ? "ECONNRESET" : undefined, request_id: "req_123456789", secret: "secret" });
    const before = events.length;
    reportBackgroundFailure(await caught(), context);
    assert.equal(events.length - before, 1, "status and credential route alone do not establish an expected rejection");
    const event = rawEvents.at(-1)!;
    const owner = status === undefined || (status === 503 && byok) ? "unknown" : byok ? "organization" : "platform";
    assert.equal(event.tags?.failure_owner, owner);
    assert.equal(event.tags?.failure_code, status === undefined ? "ECONNRESET" : `http_${status}`);
    assert.equal(event.contexts?.background_failure?.ownership, owner);
    assert.equal(event.contexts?.background_failure?.keyOwner, byok ? "organization" : "platform");
    assert.equal(event.contexts?.background_failure?.status, status);
    assert.doesNotMatch(JSON.stringify(event), /private payload|req_123456789|secret/);
  }
}
const orgUnknown = new AiProviderFailure(Object.assign(new Error("private payload"), { status: 429, request_id: "req_123456789" }), "anthropic", request.model, "organization");
const beforeOrgUnknown = events.length;
reportBackgroundFailure(orgUnknown, { ...context, retry: { retryCount: 0, retryLimit: 1 } });
assert.equal(events.length, beforeOrgUnknown, "an intermediate retry is not a terminal incident");
reportBackgroundFailure(orgUnknown, { ...context, retry: { retryCount: 1, retryLimit: 1 } });
reportBackgroundFailure(orgUnknown, { ...context, retry: { retryCount: 1, retryLimit: 1 } });
assert.equal(events.length, beforeOrgUnknown + 1, "the terminal unknown failure is reported once");
assert.equal(events.at(-1)?.tags?.failure_owner, "organization");
assert.equal(events.at(-1)?.contexts?.background_failure?.keyOwner, "organization");
assert.doesNotMatch(JSON.stringify(rawEvents.at(-1)), /private payload|req_123456789/);
const cancelledOrg = new AiProviderFailure(Object.assign(new Error("private payload"), { status: 401 }), "anthropic", request.model, "organization");
reportBackgroundFailure(cancelledOrg, { ...context, cancelled: true });
assert.equal(events.length, beforeOrgUnknown + 1, "cancelled work does not create an incident");
for (const message of ["Out of credits", "Monthly spend limit reached", "Indexing attempt is no longer current"]) {
  const before = events.length;
  reportBackgroundFailure(new Error(message), context);
  assert.equal(events.length, before);
}
// [cause, raw error, key owner (null: not a provider failure), stage, cancelled, code, ownership, retryability, reported]
for (const [cause, raw, keyOwner, stage, cancelled, code, ownership, retryability, reported] of [
  ["platform key 401", { status: 401 }, "platform", "generation", false, "http_401", "platform", "permanent", true],
  ["platform key 429", { status: 429 }, "platform", "generation", false, "http_429", "platform", "transient", true],
  ["organization key 401", { status: 401 }, "organization", "generation", false, "http_401", "organization", "permanent", true],
  ["organization key 429", { status: 429 }, "organization", "generation", false, "http_429", "organization", "permanent", true],
  ["unknown key 403", { status: 403 }, "unknown", "generation", false, "http_403", "unknown", "permanent", true],
  ["platform key 402", { status: 402 }, "platform", "generation", false, "http_402", "platform", "permanent", true],
  ["platform key 503", { status: 503 }, "platform", "generation", false, "http_503", "platform", "transient", true],
  ["organization key 529", { status: 529 }, "organization", "generation", false, "http_529", "unknown", "transient", true],
  ["invalid request", { status: 400 }, "platform", "generation", false, "http_400", "unknown", "permanent", true],
  ["stream terminated", { message: "terminated" }, "platform", "generation", false, "STREAM_TERMINATED", "unknown", "transient", true],
  ["socket reset", { code: "UND_ERR_SOCKET" }, "organization", "generation", false, "UND_ERR_SOCKET", "unknown", "transient", true],
  ["provider refusal", { code: "PROVIDER_REFUSAL" }, "platform", "generation", false, "PROVIDER_REFUSAL", "unknown", "permanent", true],
  ["malformed response", { message: "Anthropic returned empty structured output" }, "platform", "generation", false, "unclassified", "unknown", "unknown", true],
  ["connection refused", { code: "ECONNREFUSED" }, "platform", "generation", false, "ECONNREFUSED", "unknown", "unknown", true],
  ["unknown cause", { message: "private payload" }, null, "generation", false, "unclassified", "unknown", "unknown", true],
  ["indexing error", { status: 503 }, null, "indexing", false, "http_503", "unknown", "unknown", true],
  ["exhausted credits", { message: "Out of credits" }, null, "preparation", false, "unclassified", "unknown", "unknown", false],
  ["spend cap", { message: "Monthly spend limit reached" }, null, "preparation", false, "unclassified", "unknown", "unknown", false],
  ["cancellation", { status: 503 }, "platform", "generation", true, "http_503", "unknown", "permanent", false],
  ["abort", { name: "AbortError" }, "platform", "generation", false, "unclassified", "unknown", "permanent", true],
] as const) {
  const source = Object.assign(new Error("message" in raw ? raw.message : "private payload"), raw);
  const thrown = keyOwner ? new AiProviderFailure(source, "anthropic", request.model, keyOwner) : source;
  assert.deepEqual(classifyFailure(safeErrorDetails(source), keyOwner ?? "unknown", stage, cancelled), { code, ownership, retryability }, cause);
  const count = events.length;
  reportBackgroundFailure(thrown, { ...context, stage, cancelled });
  assert.equal(events.length - count, reported ? 1 : 0, cause);
  if (!reported) continue;
  const event = rawEvents.at(-1)!;
  assert.deepEqual([event.tags?.failure_code, event.tags?.failure_stage, event.tags?.failure_owner], [code, stage, ownership], cause);
  assert.deepEqual([event.contexts?.background_failure?.ownership, event.contexts?.background_failure?.retryability], [ownership, retryability], cause);
  assert.equal(event.contexts?.background_failure?.keyOwner, keyOwner ?? "unknown", cause);
}
error = new AiProviderFailure(new Error("terminated"), "anthropic", request.model, "platform");
const before = events.length;
reportBackgroundFailure(error, { ...context, retry: { retryCount: 0, retryLimit: 2 } });
reportBackgroundFailure(error, { ...context, retry: { retryCount: 1, retryLimit: 2 } });
assert.equal(events.length, before, "retryable work does not create terminal incidents");
reportBackgroundFailure(error, { ...context, retry: { retryCount: 2, retryLimit: 2 } });
assert.equal(events.length, before + 1);
failure = null;
assert.equal((await createAiMessage(request, "org")).text, "complete");
assert.equal(events.length, before + 1, "success does not emit a failure");
assert.equal(providerKeyOwner("ollama", false), "unknown");
const beforeCancelled = events.length;
reportBackgroundFailure(new Error("Indexing cancelled"), { ...context, cancelled: true });
assert.equal(events.length, beforeCancelled);
reportBackgroundFailure(new Error("Indexing cancelled"), context);
assert.equal(events.length, beforeCancelled + 1, "a message alone does not prove cancellation");
reportBackgroundFailure(new DOMException("Deadline", "TimeoutError"), context);
assert.equal(events.length, beforeCancelled + 2);
reportBackgroundFailure(new AiProviderFailure(new Error("terminated"), "anthropic", request.model, "platform"), { ...context, synthetic: true });
assert.equal(events.at(-1)?.tags?.synthetic, "true");
assert.notDeepEqual(events.at(-1)?.fingerprint, events[0].fingerprint);
assert.equal(events[0].tags?.synthetic, "false");
for (const provider of ["acp", "opencode", "claude-code"] as const) {
  for (const owner of ["organization", "platform"] as const) {
    byok = false;
    adapterOrg = owner === "organization" ? {
      acpBaseUrl: "https://acp.example.test", acpApiKey: "org-secret",
      opencodeBaseUrl: "https://opencode.example.test", opencodeApiKey: "org-secret",
      claudeCodeAuthMode: "api-key", claudeCodeApiKey: "org-secret",
    } : {};
    process.env.ACP_BASE_URL = "https://acp-platform.example.test";
    process.env.OPENCODE_BASE_URL = "https://opencode-platform.example.test";
    process.env.ACP_API_KEY = process.env.OPENCODE_API_KEY = process.env.ANTHROPIC_API_KEY = "platform-secret";
    if (owner === "platform") process.env.OCTOPUS_CLAUDE_CODE_MODE = "api-key";
    else delete process.env.OCTOPUS_CLAUDE_CODE_MODE;
    for (const status of [401, 402, 403, 429, 503]) {
      failure = Object.assign(new Error("private provider body"), { status });
      const count = events.length;
      try { await createAiMessage({ ...request, model: `${provider}:fixture` }, "org"); assert.fail("Expected failure"); }
      catch (error) {
        assert.ok(error instanceof AiProviderFailure);
        assert.equal(error.keyOwner, owner);
        assert.equal(error.details.status, status);
        reportBackgroundFailure(error, context);
      }
      assert.equal(events.length - count, 1, "unknown provider failures remain observable for either credential route");
      assert.equal(usedKeys.at(-1), owner === "organization" ? "org-secret" : "platform-secret");
    }
    failure = null;
    assert.equal((await createAiMessage({ ...request, model: `${provider}:fixture` }, "org")).text, "complete");
  }
}
delete process.env.OCTOPUS_CLAUDE_CODE_MODE;
adapterOrg = { claudeCodeAuthMode: "api-key", anthropicApiKey: "fallback-secret" };
failure = Object.assign(new Error("private provider body"), { status: 401 });
try { await createAiMessage({ ...request, model: "claude-code:fixture" }, "org"); assert.fail("Expected failure"); }
catch (error) { assert.ok(error instanceof AiProviderFailure); assert.equal(error.keyOwner, "organization"); }
assert.equal(usedKeys.at(-1), "fallback-secret");
adapterOrg = { claudeCodeAuthMode: "subscription" };
const originalPath = process.env.PATH;
process.env.PATH = "";
try { await createAiMessage({ ...request, model: "claude-code:fixture" }, "org"); assert.fail("Expected failure"); }
catch (error) {
  assert.ok(error instanceof AiProviderFailure);
  assert.equal(error.keyOwner, "unknown");
  assert.equal(error.details.code, "ENOENT");
  assert.match(error.message, /executable or file not found/);
} finally { process.env.PATH = originalPath; }

const circular = { cause: null as unknown, code: "customer-secret", name: "private@example.test" }; circular.cause = circular;
assert.deepEqual(safeErrorDetails(circular), { name: "Error" });
const hostile = { get name(): string { throw new Error(privateMarker); }, toString: () => { throw new Error(privateMarker); } };
assert.equal(new AiProviderFailure(hostile, "anthropic", request.model, "platform").message, "AI provider anthropic request failed");
const serialized = JSON.stringify(events);
for (const forbidden of ["secret", "private", "customer source", "authorization", "breadcrumbs", "exception"]) assert.ok(!serialized.includes(forbidden), forbidden);
telemetryThrows = true;
const warn = console.warn; console.warn = () => {};
assert.doesNotThrow(() => reportBackgroundFailure(new Error("unknown"), context));
console.warn = warn; console.error = originalError;
console.log("PASS provider routing, ownership, retry exhaustion, redaction and failure isolation");
