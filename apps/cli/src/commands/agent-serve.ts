import { loadCredentials, type Credentials } from "../lib/credentials.js";
import { getJson, postJson } from "../lib/api.js";

/**
 * `octp agent serve` — register this machine as a local agent for the
 * authenticated organisation and run a polling loop that claims LLM
 * tasks dispatched by cloud Octopus, runs them against local Ollama,
 * and posts the results back.
 *
 * Why: lets a developer host their org's review-LLM workload on their
 * own laptop. Cloud Octopus can use models the user has Ollama-pulled
 * locally without paying any API cost.
 *
 * Lifecycle:
 *   1. Read ~/.octopus/credentials. Exit with a helpful message if not signed in.
 *   2. POST /api/agent/register → get agentId (or reuse existing by name).
 *   3. Heartbeat every 30s.
 *   4. Poll /api/agent/llm-tasks every 2s. For each claimed task:
 *        run via local Ollama → POST /api/agent/llm-tasks/<id>/complete.
 *   5. On SIGINT: POST /api/agent/disconnect, exit 0.
 */

const HEARTBEAT_INTERVAL_MS = 30_000;
const POLL_INTERVAL_MS = 2000;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
// Bound Ollama calls — without this a stuck model load or hung GPU hangs the
// agent indefinitely, which then misses heartbeats. Override via
// OCTP_OLLAMA_TIMEOUT_MS for large models that legitimately need more time.
const OLLAMA_TIMEOUT_MS = Number(process.env.OCTP_OLLAMA_TIMEOUT_MS ?? 5 * 60_000);
// How many tasks to run in parallel. Default 1 (serial) — Ollama generally
// shares a single GPU and parallel calls just queue inside the daemon. Bump
// to N (e.g. 2-4) on multi-GPU rigs or when running a tiny model that fits
// many copies in memory. Clamped to [1, 16] so a typo can't kick off 1000
// concurrent fetches.
const RAW_CONCURRENCY = Number(process.env.OCTP_AGENT_CONCURRENCY ?? 1);
const CONCURRENCY = Math.max(
  1,
  Math.min(16, Number.isFinite(RAW_CONCURRENCY) ? Math.floor(RAW_CONCURRENCY) : 1),
);

type AgentRegisterResponse = {
  agentId: string;
  agentName: string;
};

type LlmTask = {
  id: string;
  modelId: string;
  system: string | null;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens: number;
  createdAt: string;
};

type OllamaResponse = {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export async function agentServeCommand(argv: string[]): Promise<number> {
  const creds = await loadCredentials();
  if (!creds) {
    console.error(
      "No credentials. Run `octp` to sign in first, or `octp onboard` to redo the wizard.",
    );
    return 2;
  }

  // Parse optional flags
  const agentName = flagValue(argv, "--name") ?? defaultAgentName();
  const verbose = argv.includes("--verbose") || argv.includes("-v");

  console.log(`octp agent serve — connecting to ${creds.baseUrl} as ${creds.orgName} / ${agentName}`);

  // Quick Ollama health-check so the user finds out about a stopped daemon
  // before tasks start landing.
  const ollamaUp = await checkOllama();
  if (!ollamaUp) {
    console.error(
      `Could not reach Ollama at ${OLLAMA_BASE_URL}. Start it with \`ollama serve\` and try again.`,
    );
    return 2;
  }
  console.log(`✓ Ollama reachable at ${OLLAMA_BASE_URL}`);

  const reg = await registerAgent(creds, agentName);
  if (!reg.ok) {
    console.error(`Register failed: ${reg.error}`);
    return 1;
  }
  const { agentId } = reg.data;
  console.log(`✓ Registered as agent ${agentId}`);

  // Shutdown: clear timers, wait briefly for in-flight tasks to post their
  // results so the server doesn't see hung "claimed" tasks, then disconnect.
  // The shuttingDown flag is checked inside the poll/heartbeat loops so they
  // exit before this function calls process.exit().
  let shuttingDown = false;
  const inFlight = new Set<Promise<void>>();
  const SHUTDOWN_GRACE_MS = 5000;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nShutting down — sending disconnect …");
    if (heartbeat) clearInterval(heartbeat);
    // Give the in-flight task(s) up to SHUTDOWN_GRACE_MS to post their results.
    if (inFlight.size > 0) {
      await Promise.race([
        Promise.all(Array.from(inFlight)),
        sleep(SHUTDOWN_GRACE_MS),
      ]).catch(() => {});
    }
    await postJson(`${creds.baseUrl}/api/agent/disconnect`, { agentId }, creds.token).catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Heartbeat loop
  heartbeat = setInterval(async () => {
    if (shuttingDown) return;
    await postJson(`${creds.baseUrl}/api/agent/heartbeat`, { agentId }, creds.token).catch((e) => {
      if (verbose) console.error("[heartbeat]", e instanceof Error ? e.message : String(e));
    });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  // Polling loop. Tasks within a single poll run with up to CONCURRENCY
  // parallelism — see RAW_CONCURRENCY at top-of-file for the env override.
  // Default 1 (serial) matches the single-GPU-Ollama common case.
  console.log(
    `Polling for tasks every ${POLL_INTERVAL_MS / 1000}s (concurrency=${CONCURRENCY}). Ctrl+C to stop.`,
  );
  let exitCode = 0;
  while (!shuttingDown) {
    try {
      const tasks = await fetchTasks(creds, agentId);
      // Process tasks in chunks of CONCURRENCY so shutdown can break between
      // chunks rather than waiting for every claimed task to finish.
      for (let i = 0; i < tasks.length; i += CONCURRENCY) {
        if (shuttingDown) break;
        const chunk = tasks.slice(i, i + CONCURRENCY);
        if (verbose) {
          for (const task of chunk) console.log(`  task ${task.id} model=${task.modelId}`);
        }
        const promises = chunk.map((task) => {
          const p = runOneTask(creds, agentId, task, verbose).finally(() => {
            inFlight.delete(p);
          });
          inFlight.add(p);
          return p;
        });
        await Promise.all(promises).catch(() => {
          // runOneTask catches its own errors and reports failure via /complete;
          // a rejection here would only come from an unexpected throw and is
          // already logged by runOneTask.
        });
      }
    } catch (e) {
      // Auth failure won't recover by retrying — surface and exit so a
      // revoked or expired token doesn't generate an endless 401 stream.
      if (e instanceof AuthError) {
        console.error(`\nAuthentication rejected (HTTP ${e.status}): ${e.message}`);
        console.error("Run `octp` to re-authenticate, then start the agent again.");
        exitCode = 2;
        break;
      }
      if (verbose) console.error("[poll]", e instanceof Error ? e.message : String(e));
    }
    if (!shuttingDown) await sleep(POLL_INTERVAL_MS);
  }

  if (heartbeat) clearInterval(heartbeat);
  await postJson(`${creds.baseUrl}/api/agent/disconnect`, { agentId }, creds.token).catch(() => {});
  return exitCode;
}

async function checkOllama(): Promise<boolean> {
  try {
    const r = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    return r.ok;
  } catch {
    return false;
  }
}

async function registerAgent(creds: Credentials, agentName: string) {
  return await postJson<AgentRegisterResponse>(
    `${creds.baseUrl}/api/agent/register`,
    {
      name: agentName,
      capabilities: ["llm-completion", "ollama"],
      machineInfo: {
        os: process.platform,
        hostname: process.env.HOSTNAME ?? "",
        nodeVersion: process.version,
      },
    },
    creds.token,
  );
}

// Raised by fetchTasks on auth failure (401/403). The polling loop checks
// for this and exits — retrying a revoked or expired token would never
// recover and would spam the server indefinitely.
class AuthError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function fetchTasks(creds: Credentials, agentId: string): Promise<LlmTask[]> {
  const res = await getJson<{ tasks: LlmTask[] }>(
    `${creds.baseUrl}/api/agent/llm-tasks?agentId=${encodeURIComponent(agentId)}`,
    { headers: { authorization: `Bearer ${creds.token}` } },
  );
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new AuthError(res.status, res.error);
    }
    throw new Error(res.error);
  }
  return res.data.tasks;
}

async function runOneTask(
  creds: Credentials,
  agentId: string,
  task: LlmTask,
  verbose: boolean,
): Promise<void> {
  const completeUrl = `${creds.baseUrl}/api/agent/llm-tasks/${task.id}/complete`;
  try {
    if (!task.modelId.startsWith("ollama:") && !task.modelId.includes(":")) {
      // Not an Ollama-prefixed model and not bare — assume Ollama anyway,
      // but log so the user knows what's happening.
      if (verbose) console.log(`  (assuming Ollama for unprefixed model "${task.modelId}")`);
    }
    const model = task.modelId.startsWith("ollama:") ? task.modelId.slice(7) : task.modelId;

    const messages: { role: string; content: string }[] = [];
    if (task.system) messages.push({ role: "system", content: task.system });
    for (const m of task.messages) messages.push({ role: m.role, content: m.content });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${OLLAMA_BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer ollama" },
        body: JSON.stringify({ model, max_tokens: task.maxTokens, messages, stream: false }),
        signal: controller.signal,
      });
    } catch (e) {
      if (controller.signal.aborted) {
        throw new Error(`Ollama timed out after ${Math.round(OLLAMA_TIMEOUT_MS / 1000)}s`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    const body = (await response.json()) as OllamaResponse;
    const text = body.choices?.[0]?.message?.content ?? "";

    // agentId is REQUIRED by the server's /complete endpoint: it verifies
    // the caller is the agent that originally claimed the task and returns
    // 403 on mismatch, preventing one agent from overwriting another's
    // in-flight result.
    await postJson(
      completeUrl,
      {
        agentId,
        text,
        usage: {
          inputTokens: body.usage?.prompt_tokens ?? 0,
          outputTokens: body.usage?.completion_tokens ?? 0,
        },
      },
      creds.token,
    );
    if (verbose) console.log(`  ✓ completed ${task.id} (${text.length} chars)`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  ✗ failed ${task.id}: ${msg}`);
    await postJson(completeUrl, { agentId, error: msg }, creds.token).catch(() => {});
  }
}

function flagValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  if (!v || v.startsWith("-")) return undefined;
  return v;
}

function defaultAgentName(): string {
  const host = process.env.HOSTNAME ?? "agent";
  return `${host}-${process.pid}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
