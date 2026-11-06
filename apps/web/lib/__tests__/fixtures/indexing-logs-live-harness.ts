import { mock } from "bun:test";
import assert from "node:assert/strict";

const hooks: Array<{ value?: unknown; current?: unknown; deps?: unknown[]; cleanup?: () => void }> = [];
let hookIndex = 0;
let scheduled = false;
let tree: unknown;
const same = (a: unknown[] | undefined, b: unknown[]) => !!a && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const schedule = () => {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => { scheduled = false; render(); });
};
const effects: Array<() => void> = [];
const react = {
  useState(initial: unknown) {
    const index = hookIndex++;
    if (!hooks[index]) hooks[index] = { value: initial };
    return [hooks[index].value, (next: unknown) => {
      const value = typeof next === "function" ? next(hooks[index].value) : next;
      if (!Object.is(value, hooks[index].value)) { hooks[index].value = value; schedule(); }
    }];
  },
  useRef(initial: unknown) {
    const index = hookIndex++;
    if (!hooks[index]) hooks[index] = { current: initial };
    return hooks[index];
  },
  useEffect(fn: () => void | (() => void), deps: unknown[]) {
    const index = hookIndex++;
    if (!hooks[index]) hooks[index] = {};
    if (!same(hooks[index].deps, deps)) {
      effects.push(() => {
        hooks[index].cleanup?.();
        hooks[index].deps = deps;
        const cleanup = fn();
        hooks[index].cleanup = typeof cleanup === "function" ? cleanup : undefined;
      });
    }
  },
};
function render() {
  hookIndex = 0;
  tree = component();
  for (const effect of effects.splice(0)) effect();
}
const jsx = (type: unknown, props: unknown) => ({ type, props });
mock.module("react", () => react);
mock.module("react/jsx-runtime", () => ({ jsx, jsxs: jsx, Fragment: "fragment" }));
mock.module("react/jsx-dev-runtime", () => ({ jsxDEV: jsx, Fragment: "fragment" }));
mock.module("next/navigation", () => ({ useRouter: () => router }));
mock.module("@tabler/icons-react", () => Object.fromEntries(["IconCircleCheck", "IconCircleX", "IconAlertTriangle", "IconLoader2", "IconTerminal", "IconPoint", "IconExternalLink"].map(name => [name, () => null])));
const listeners = new Map<string, (data: unknown) => void>();
mock.module("@/lib/pubby-client", () => ({ getPubbyClient: () => ({ subscribe: () => ({
  bind: (name: string, fn: (data: unknown) => void) => listeners.set(name, fn),
  unbind: (name: string) => listeners.delete(name),
}) }) }));
mock.module("@/lib/repository-connection-recovery", () => ({ getRepositoryConnectionRecovery: () => ({ href: "/", label: "Reconnect" }) }));
const router = { refresh() {} };
const requests: Array<{ resolve: (response: Response) => void; reject: (error: Error) => void }> = [];
globalThis.fetch = ((_url: unknown, options: { signal: AbortSignal }) => new Promise<Response>((resolve, reject) => {
  requests.push({ resolve, reject });
  options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
})) as typeof fetch;
const { IndexingLogs } = await import("@/components/indexing-logs");
let repoId = "repo-a";
const component = () => IndexingLogs({ repoId, orgId: "org-a", initialStatus: "indexing", provider: "github" });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const text = (node: unknown): string => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join(" ") : typeof node === "object" ? text((node as { props?: { children?: unknown } }).props?.children) : String(node);
const emit = (name: string, data: unknown) => { assert.ok(listeners.has(name)); listeners.get(name)!(data); };
const reply = async (index: number, body: unknown) => { requests[index].resolve(Response.json(body)); await flush(); };
try {
  render();
  emit("index-log", { repoId: "repo-a", message: "Processed 4000 files, skipped 0", level: "info", timestamp: 1 });
  emit("index-log", { repoId: "other-repo", message: "Processed 4010 files, skipped 0", level: "info", timestamp: 2 });
  await reply(0, { logs: [], attempt: "owner-a" });
  assert.match(text(tree), /Processed 4000 files, skipped 0/);
  assert.match(text(tree), /multiple attempts or be missing/);
  assert.doesNotMatch(text(tree), /Processed 4010 files, skipped 0/);
  emit("index-status", { repoId: "repo-a" });
  await flush();
  emit("index-log", { repoId: "repo-a", message: "Processed 4006 files, skipped 0", level: "warning", timestamp: 3 });
  emit("index-log", { repoId: "repo-a", indexAttemptId: "owner-a", message: "Processed 4011 files, skipped 0", level: "error", timestamp: 4 });
  emit("index-log", { repoId: "repo-a", indexAttemptId: "owner-b", message: "Processed 4012 files, skipped 0", level: "info", timestamp: 5 });
  await reply(1, { logs: [], attempt: "owner-b" });
  assert.match(text(tree), /Processed 4000 files, skipped 0/);
  assert.match(text(tree), /Processed 4006 files, skipped 0/);
  assert.match(text(tree), /Processed 4012 files, skipped 0/);
  assert.match(text(tree), /multiple attempts or be missing/);
  assert.doesNotMatch(text(tree), /Processed 4011 files, skipped 0/);
  emit("index-status", { repoId: "repo-a" });
  await flush();
  await reply(2, { logs: [{ message: "Processed 4007 files, skipped 0", level: "info", timestamp: 6 }] });
  assert.match(text(tree), /Processed 4007 files, skipped 0/);
  assert.match(text(tree), /Processed 4006 files, skipped 0/);
  assert.doesNotMatch(text(tree), /Processed 4012 files, skipped 0/);
  const refresh = async (attempt: string, logs: unknown[] = []) => {
    emit("index-status", { repoId: "repo-a" });
    await flush();
    await reply(requests.length - 1, { logs, attempt });
  };
  await refresh("owner-c");
  for (const [message, timestamp, taggedFirst] of [["Processed 4005 files, skipped 0", 20, true], ["Processed 4002 files, skipped 0", 21, false]] as const) {
    const untagged = { repoId: "repo-a", message, level: "warning", timestamp };
    const tagged = { ...untagged, indexAttemptId: "owner-c" };
    for (const event of taggedFirst ? [tagged, untagged] : [untagged, tagged]) emit("index-log", event);
  }
  await flush();
  for (const message of ["Processed 4005 files, skipped 0", "Processed 4002 files, skipped 0"]) {
    assert.equal(text(tree).split(message).length - 1, 2);
  }
  await refresh("owner-d");
  for (const message of ["Processed 4005 files, skipped 0", "Processed 4002 files, skipped 0"]) {
    assert.equal(text(tree).split(message).length - 1, 1);
  }
  const snapshotFirst = { message: "Processed 4001 files, skipped 0", level: "warning", timestamp: 22, indexAttemptId: "owner-d" };
  await refresh("owner-d", [snapshotFirst]);
  emit("index-log", { repoId: "repo-a", message: snapshotFirst.message, level: snapshotFirst.level, timestamp: snapshotFirst.timestamp });
  const liveFirst = { message: "Processed 4009 files, skipped 0", level: "warning", timestamp: 23 };
  emit("index-log", { repoId: "repo-a", ...liveFirst });
  await flush();
  await refresh("owner-d", [snapshotFirst, { ...liveFirst, indexAttemptId: "owner-d" }]);
  for (const message of [snapshotFirst.message, liveFirst.message]) {
    assert.equal(text(tree).split(message).length - 1, 2);
  }
  await refresh("owner-e");
  for (const message of [snapshotFirst.message, liveFirst.message]) {
    assert.equal(text(tree).split(message).length - 1, 1);
  }
  assert.match(text(tree), /multiple attempts or be missing/);
  emit("index-status", { repoId: "repo-a" });
  await flush();
  await reply(requests.length - 1, { logs: [{ message: "Processed 4008 files, skipped 0", level: "error", timestamp: 30 }, { message: "Processed 4013 files, skipped 0", level: "info", timestamp: 31 }], attempt: null, indexAttemptId: "legacy-a" });
  emit("index-log", { repoId: "repo-a", message: "Processed 4013 files, skipped 0", level: "info", timestamp: 31 });
  emit("index-log", { repoId: "repo-a", message: "Processed 4003 files, skipped 0", level: "info", timestamp: 32 });
  await flush();
  emit("index-status", { repoId: "repo-a" });
  await flush();
  await reply(requests.length - 1, { logs: [], attempt: null });
  assert.match(text(tree), /Processed 4008 files, skipped 0/);
  emit("index-status", { repoId: "repo-a" });
  await flush();
  await reply(requests.length - 1, { logs: [], attempt: null, indexAttemptId: "legacy-b" });
  assert.doesNotMatch(text(tree), /Processed 4008 files, skipped 0/);
  assert.match(text(tree), /Processed 4013 files, skipped 0/);
  assert.match(text(tree), /Processed 4003 files, skipped 0/);
  assert.match(text(tree), /multiple attempts or be missing/);
  for (const [batch, logs] of [["batch-a", [{ indexAttemptId: "upload", message: "Processed 4004 files, skipped 0", level: "info", timestamp: 40 }]], [null, []], ["batch-b", []]] as const) {
    emit("index-status", { repoId: "repo-a" });
    await flush();
    await reply(requests.length - 1, { logs, attempt: "upload", indexAttemptId: batch });
    assert.match(text(tree), /Processed 4004 files, skipped 0/);
  }
  emit("index-status", { repoId: "repo-a" });
  await flush();
  await reply(requests.length - 1, { logs: [], attempt: "new-upload", indexAttemptId: "new-batch" });
  assert.doesNotMatch(text(tree), /Processed 4004 files, skipped 0/);
  const withheld = "Indexing message withheld for privacy.";
  for (const owner of [null, "collision-owner"] as const) {
    const pair = [{ message: withheld, level: "error", timestamp: 80, ...(owner ? { indexAttemptId: owner } : {}) },
      { message: withheld, level: "error", timestamp: 80, ...(owner ? { indexAttemptId: owner } : {}) }];
    for (let i = 0; i < 2; i++) {
      emit("index-status", { repoId: "repo-a" });
      await flush();
      await reply(requests.length - 1, { logs: pair, attempt: owner, indexAttemptId: owner ?? "legacy-collision" });
      assert.equal(text(tree).split(withheld).length - 1, owner ? 3 : 2);
    }
    emit("index-log", { repoId: "repo-a", message: withheld, level: "error", timestamp: 80, ...(owner ? { indexAttemptId: owner } : {}) });
    await flush();
    assert.equal(text(tree).split(withheld).length - 1, owner ? 4 : 3);
    assert.match(text(tree), /Indexing messages may include duplicates/);
    emit("index-status", { repoId: "repo-a" });
    await flush();
    await reply(requests.length - 1, { logs: [], attempt: owner ? "next-owner" : null, indexAttemptId: owner ? "next-owner" : "legacy-replacement" });
    assert.equal(text(tree).split(withheld).length - 1, 1);
  }
  for (const [owner, buffered, timestamp] of [[null, false, 100], [null, true, 101], ["tagged-ambiguous", false, 102], ["tagged-buffered", true, 103]] as const) {
    const identity = owner ?? `legacy-${timestamp}`;
    const saved = { message: withheld, level: "warning", timestamp, ...(owner ? { indexAttemptId: owner } : {}) };
    const live = { repoId: "repo-a", message: `Processed ${timestamp+1000} files, skipped 0`, level: "warning", timestamp, ...(owner ? { indexAttemptId: owner } : {}) };
    emit("index-status", { repoId: "repo-a" });
    await flush();
    if (buffered) emit("index-log", live);
    await reply(requests.length - 1, { logs: [saved], attempt: owner, indexAttemptId: identity });
    if (!buffered) { emit("index-log", live); await flush(); }
    assert.match(text(tree), new RegExp(live.message));
    assert.match(text(tree), /Indexing messages may include duplicates/);
    const count = text(tree).split(withheld).length - 1;
    emit("index-status", { repoId: "repo-a" });
    await flush();
    await reply(requests.length - 1, { logs: [saved], attempt: owner, indexAttemptId: identity });
    assert.equal(text(tree).split(withheld).length - 1, count);
    assert.match(text(tree), new RegExp(live.message));
  }
  for (const [owner, buffered, timestamp] of [[null, false, 200], [null, true, 201], ["exact-first", false, 202], ["exact-buffered", true, 203]] as const) {
    const identity = owner ?? `legacy-exact-${timestamp}`;
    const message = `Processed ${timestamp+2000} files, skipped 0`;
    const entry = { message, level: "warning", timestamp, ...(owner ? { indexAttemptId: owner } : {}) };
    const live = { ...entry, repoId: "repo-a" };
    emit("index-status", { repoId: "repo-a" });
    await flush();
    if (buffered) { emit("index-log", live); emit("index-log", live); }
    await reply(requests.length - 1, { logs: [entry], attempt: owner, indexAttemptId: identity });
    if (!buffered) { emit("index-log", live); emit("index-log", live); await flush(); }
    assert.equal(text(tree).split(message).length - 1, 3);
    assert.match(text(tree), /Indexing messages may include duplicates/);
    emit("index-status", { repoId: "repo-a" });
    await flush();
    emit("index-log", { ...live, indexAttemptId: "stale-tagged", message: `Processed ${timestamp+3000} files, skipped 0` });
    await reply(requests.length - 1, { logs: [entry], attempt: owner, indexAttemptId: identity });
    assert.equal(text(tree).split(message).length - 1, 3);
    assert.doesNotMatch(text(tree), new RegExp(`Processed ${timestamp+3000} files, skipped 0`));
    emit("index-status", { repoId: "repo-a" });
    await flush();
    await reply(requests.length - 1, { logs: [], attempt: owner ? `replacement-${timestamp}` : null, indexAttemptId: owner ? `replacement-${timestamp}` : `replacement-legacy-${timestamp}` });
    assert.equal(text(tree).split(message).length - 1, owner ? 0 : 2);
  }
  emit("index-status", { repoId: "repo-a" });
  await flush();
  for (let i = 0; i < 1001; i++) {
    emit("index-log", { repoId: "repo-a", message: `Processed ${30000 + i} files, skipped 0`, level: "warning", timestamp: 30000 + i });
  }
  await flush();
  const assertUntaggedBatch = () => {
    const displayed = text(tree);
    for (let i = 0; i < 1001; i++) assert.equal(displayed.split(`Processed ${30000 + i} files, skipped 0`).length - 1, 1);
    assert.doesNotMatch(displayed, /Some indexing messages may be missing while logs were loading/);
  };
  assertUntaggedBatch();
  await reply(requests.length - 1, { logs: [], attempt: "after-overflow" });
  assertUntaggedBatch();
  await refresh("later-owner");
  assertUntaggedBatch();
  repoId = "repo-b";
  render();
  await reply(requests.length - 1, { logs: [{ indexAttemptId: "owner-a", message: "Processed 9001 files, skipped 0", level: "info", timestamp: 1 }], attempt: "owner-a" });
  const warning = /may belong to an earlier attempt/;
  assert.doesNotMatch(text(tree), warning);
  emit("index-status", { repoId });
  await flush();
  assert.match(text(tree), /Processed 9001 files, skipped 0/);
  assert.match(text(tree), warning);
  requests[requests.length - 1].reject(new Error("unavailable"));
  await flush();
  assert.match(text(tree), warning);
  emit("index-status", { repoId });
  await flush();
  await reply(requests.length - 1, { logs: [{ indexAttemptId: "owner-b", message: "Processed 9002 files, skipped 0", level: "info", timestamp: 2 }], attempt: "owner-b" });
  assert.doesNotMatch(text(tree), warning);
  assert.doesNotMatch(text(tree), /Processed 9001 files, skipped 0/);
  emit("index-log", { repoId, indexAttemptId: "owner-c", message: "Processed 9003 files, skipped 0", level: "info", timestamp: 3 });
  await flush();
  assert.match(text(tree), warning);
  assert.doesNotMatch(text(tree), /Processed 9003 files, skipped 0/);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await flush();
  await reply(requests.length - 1, { logs: [], attempt: "owner-c" });
  assert.match(text(tree), /Processed 9003 files, skipped 0/);
  assert.doesNotMatch(text(tree), warning);
  const later = { repoId, indexAttemptId: "owner-c", message: "Processed 9020 files, skipped 0", level: "info", timestamp: 20 };
  const earlier = { ...later, message: "Processed 9010 files, skipped 0", timestamp: 10 };
  emit("index-log", later);
  emit("index-log", earlier);
  emit("index-log", earlier);
  await flush();
  const assertOrdered = () => {
    const displayed = text(tree);
    assert.ok(displayed.indexOf(earlier.message) < displayed.indexOf(later.message));
    assert.equal(displayed.split(earlier.message).length - 1, 2);
    assert.equal(displayed.split(later.message).length - 1, 1);
  };
  assertOrdered();
  emit("index-status", { repoId });
  await flush();
  await reply(requests.length - 1, { logs: [], attempt: "owner-c" });
  assertOrdered();
} finally {
  for (const hook of hooks) hook?.cleanup?.();
}
