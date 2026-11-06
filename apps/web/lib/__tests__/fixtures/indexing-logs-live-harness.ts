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
const component = () => IndexingLogs({ repoId: "repo-a", orgId: "org-a", initialStatus: "indexing", provider: "github" });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const text = (node: unknown): string => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join(" ") : typeof node === "object" ? text((node as { props?: { children?: unknown } }).props?.children) : String(node);
const emit = (name: string, data: unknown) => { assert.ok(listeners.has(name)); listeners.get(name)!(data); };
const reply = async (index: number, body: unknown) => { requests[index].resolve(Response.json(body)); await flush(); };
try {
  render();
  emit("index-log", { repoId: "repo-a", message: "Before owner lookup", level: "info", timestamp: 1 });
  emit("index-log", { repoId: "other-repo", message: "Other tenant", level: "info", timestamp: 2 });
  await reply(0, { logs: [], attempt: "owner-a" });
  assert.match(text(tree), /Before owner lookup/);
  assert.match(text(tree), /multiple attempts or be missing/);
  assert.doesNotMatch(text(tree), /Other tenant/);
  emit("index-status", { repoId: "repo-a" });
  await flush();
  emit("index-log", { repoId: "repo-a", message: "Delayed untagged", level: "warning", timestamp: 3 });
  emit("index-log", { repoId: "repo-a", indexAttemptId: "owner-a", message: "Stale tagged", level: "error", timestamp: 4 });
  emit("index-log", { repoId: "repo-a", indexAttemptId: "owner-b", message: "New tagged", level: "info", timestamp: 5 });
  await reply(1, { logs: [], attempt: "owner-b" });
  assert.match(text(tree), /Before owner lookup/);
  assert.match(text(tree), /Delayed untagged/);
  assert.match(text(tree), /New tagged/);
  assert.match(text(tree), /multiple attempts or be missing/);
  assert.doesNotMatch(text(tree), /Stale tagged/);
  emit("index-status", { repoId: "repo-a" });
  await flush();
  await reply(2, { logs: [{ message: "Legacy snapshot", level: "info", timestamp: 6 }] });
  assert.match(text(tree), /Legacy snapshot/);
  assert.match(text(tree), /Delayed untagged/);
  assert.doesNotMatch(text(tree), /New tagged/);
  const refresh = async (attempt: string, logs: unknown[] = []) => {
    emit("index-status", { repoId: "repo-a" });
    await flush();
    await reply(requests.length - 1, { logs, attempt });
  };
  await refresh("owner-c");
  for (const [message, timestamp, taggedFirst] of [["Same tagged first", 20, true], ["Same untagged first", 21, false]] as const) {
    const untagged = { repoId: "repo-a", message, level: "warning", timestamp };
    const tagged = { ...untagged, indexAttemptId: "owner-c" };
    for (const event of taggedFirst ? [tagged, untagged] : [untagged, tagged]) emit("index-log", event);
  }
  await flush();
  for (const message of ["Same tagged first", "Same untagged first"]) {
    assert.equal(text(tree).split(message).length - 1, 2);
  }
  await refresh("owner-d");
  for (const message of ["Same tagged first", "Same untagged first"]) {
    assert.equal(text(tree).split(message).length - 1, 1);
  }
  const snapshotFirst = { message: "Same snapshot first", level: "warning", timestamp: 22, indexAttemptId: "owner-d" };
  await refresh("owner-d", [snapshotFirst]);
  emit("index-log", { repoId: "repo-a", message: snapshotFirst.message, level: snapshotFirst.level, timestamp: snapshotFirst.timestamp });
  const liveFirst = { message: "Same live first", level: "warning", timestamp: 23 };
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
  await reply(requests.length - 1, { logs: [{ message: "Old saved error", level: "error", timestamp: 30 }, { message: "Collision", level: "info", timestamp: 31 }], attempt: null, indexAttemptId: "legacy-a" });
  emit("index-log", { repoId: "repo-a", message: "Collision", level: "info", timestamp: 31 });
  emit("index-log", { repoId: "repo-a", message: "Early replacement", level: "info", timestamp: 32 });
  await flush();
  emit("index-status", { repoId: "repo-a" });
  await flush();
  await reply(requests.length - 1, { logs: [], attempt: null });
  assert.match(text(tree), /Old saved error/);
  emit("index-status", { repoId: "repo-a" });
  await flush();
  await reply(requests.length - 1, { logs: [], attempt: null, indexAttemptId: "legacy-b" });
  assert.doesNotMatch(text(tree), /Old saved error/);
  assert.match(text(tree), /Collision/);
  assert.match(text(tree), /Early replacement/);
  assert.match(text(tree), /multiple attempts or be missing/);
  for (const [batch, logs] of [["batch-a", [{ indexAttemptId: "upload", message: "First batch saved", level: "info", timestamp: 40 }]], [null, []], ["batch-b", []]] as const) {
    emit("index-status", { repoId: "repo-a" });
    await flush();
    await reply(requests.length - 1, { logs, attempt: "upload", indexAttemptId: batch });
    assert.match(text(tree), /First batch saved/);
  }
  emit("index-status", { repoId: "repo-a" });
  await flush();
  await reply(requests.length - 1, { logs: [], attempt: "new-upload", indexAttemptId: "new-batch" });
  assert.doesNotMatch(text(tree), /First batch saved/);
} finally {
  for (const hook of hooks) hook?.cleanup?.();
}
