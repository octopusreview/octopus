import os from "node:os";
import { loadCredentials, type Credentials } from "../lib/credentials.js";
import { loadConfig, DEFAULT_OLLAMA_BASE_URL } from "../lib/config.js";
import { getJson, postJson } from "../lib/api.js";
import { sanitizeTerminal } from "../lib/output.js";
import { resolveWatchedRepos } from "../lib/agent-watch.js";
import { runCodeSearch } from "../lib/code-search.js";

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
 *
 * Ollama URL precedence: OLLAMA_BASE_URL env (wins) → ollamaBaseUrl in
 * ~/.octopus/config.json (set by the wizard) → built-in default
 * http://localhost:11434.
 */

const HEARTBEAT_INTERVAL_MS = 30_000;
const POLL_INTERVAL_MS = 2000;
// Bound each task-poll request. Without it, getJson has no timeout, so a server
// that accepts the connection but never responds parks the loop forever — and
// because both loops must finish before `agent serve` returns, a stalled poll on
// one loop would block the clean exit the OTHER loop wants after an auth error.
// A timed-out poll surfaces as {ok:false,status:0} (retried) and lets the loop
// re-check `shuttingDown` and exit.
const POLL_TIMEOUT_MS = 15_000;
// Bound Ollama calls — without this a stuck model load or hung GPU hangs the
// agent indefinitely, which then misses heartbeats. Override via
// OCTP_OLLAMA_TIMEOUT_MS for large models that legitimately need more time.
// Guarded the same way as RAW_CONCURRENCY below: Number("5m") is NaN, and
// setTimeout(cb, NaN) fires after ~1ms, so every claimed task would abort
// instantly with "timed out after NaNs". Reject malformed values and fall
// back to the default.
const RAW_OLLAMA_TIMEOUT_MS = Number(process.env.OCTP_OLLAMA_TIMEOUT_MS ?? 5 * 60_000);
const OLLAMA_TIMEOUT_MS =
  Number.isFinite(RAW_OLLAMA_TIMEOUT_MS) && RAW_OLLAMA_TIMEOUT_MS > 0
    ? RAW_OLLAMA_TIMEOUT_MS
    : 5 * 60_000;
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

type SearchTask = {
  id: string;
  query: string;
  searchType: string;
  params: Record<string, unknown> | null;
  repoFullName: string;
  timeoutMs: number;
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
  const explicitName = flagValue(argv, "--name");
  const agentName = explicitName ?? defaultAgentName();
  const verbose = argv.includes("--verbose") || argv.includes("-v");

  // Warn (don't fail) when default name + a generic-looking hostname mean
  // the agent will be hard to tell apart on the server. Generic hostnames
  // are common in container / VM defaults and almost guarantee a collision
  // if more than one host is involved.
  if (!explicitName) {
    const h = agentName.toLowerCase();
    const looksGeneric =
      h === "agent" ||
      h === "localhost" ||
      h === "ubuntu" ||
      h === "debian" ||
      /^[a-f0-9-]{8,}$/.test(h);
    if (looksGeneric) {
      console.warn(
        `! Default agent name is "${agentName}" — generic hostname likely to collide ` +
          `with other agents. Pass --name <distinguishing-suffix> if running multiple.`,
      );
    }
  }

  // Resolve Ollama URL: env wins, then wizard-saved config, then default.
  const config = await loadConfig();
  const ollamaBaseUrl =
    process.env.OLLAMA_BASE_URL ?? config.ollamaBaseUrl ?? DEFAULT_OLLAMA_BASE_URL;

  // Decide what this daemon can serve and register the UNION of capabilities:
  //  - LLM-completion tasks, when Ollama is reachable.
  //  - Code-search tasks, when the active account watches one or more repos.
  const { repos: watchedRepos, warnings } = await resolveWatchedRepos();
  const repoFullNames = [...watchedRepos.keys()];
  const ollamaUp = await checkOllama(ollamaBaseUrl);
  const doLlm = ollamaUp;
  const doSearch = repoFullNames.length > 0;

  if (!doLlm && !doSearch) {
    console.error(
      `Nothing to serve: Ollama is unreachable at ${ollamaBaseUrl} AND no repos are watched.\n` +
        "Start Ollama (`ollama serve`) for LLM tasks, and/or `octp agent watch <dir>` for code-search.",
    );
    return 2;
  }

  const capabilities = [
    ...(doLlm ? ["llm-completion", "ollama"] : []),
    ...(doSearch ? ["code-search"] : []),
  ];

  console.log(
    `octp agent serve — ${sanitizeTerminal(creds.orgName)} as ${sanitizeTerminal(agentName)} (${sanitizeTerminal(creds.baseUrl)})`,
  );
  console.log(`  capabilities: ${capabilities.join(", ")}`);
  console.log(
    doLlm
      ? `✓ Ollama reachable at ${ollamaBaseUrl}`
      : `· Ollama unreachable at ${ollamaBaseUrl} — LLM tasks disabled`,
  );
  console.log(
    doSearch
      ? `✓ watching ${repoFullNames.length} repo(s): ${repoFullNames.map((r) => sanitizeTerminal(r)).join(", ")}`
      : "· no watched repos — code-search disabled (`octp agent watch <dir>`)",
  );
  for (const w of warnings) console.log(`  ! ${sanitizeTerminal(w)}`);

  const reg = await registerAgent(creds, agentName, repoFullNames, capabilities);
  if (!reg.ok) {
    console.error(`Register failed: ${sanitizeTerminal(reg.error)}`);
    return 1;
  }
  const { agentId } = reg.data;
  console.log(`✓ Registered as agent ${agentId}`);

  // Shared daemon state across both poll loops + shutdown.
  let shuttingDown = false;
  let exitCode = 0;
  const inFlight = new Set<Promise<void>>();
  const SHUTDOWN_GRACE_MS = 5000;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nShutting down — sending disconnect …");
    if (heartbeat) clearInterval(heartbeat);
    if (inFlight.size > 0) {
      await Promise.race([Promise.all(Array.from(inFlight)), sleep(SHUTDOWN_GRACE_MS)]).catch(() => {});
    }
    await postJson(`${creds.baseUrl}/api/agent/disconnect`, { agentId }, creds.token).catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  heartbeat = setInterval(async () => {
    if (shuttingDown) return;
    await postJson(
      `${creds.baseUrl}/api/agent/heartbeat`,
      { agentId, repoFullNames },
      creds.token,
    ).catch((e) => {
      if (verbose) console.error("[heartbeat]", e instanceof Error ? e.message : String(e));
    });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  // Auth failure won't recover by retrying — stop BOTH loops and exit so a
  // revoked/expired token doesn't spin forever.
  const onAuthError = (e: AuthError) => {
    console.error(`\nAuthentication rejected (HTTP ${e.status}): ${sanitizeTerminal(e.message)}`);
    console.error("Run `octp` to re-authenticate, then start the agent again.");
    exitCode = 2;
    shuttingDown = true;
  };
  const track = (p: Promise<void>): Promise<void> => {
    const q = p.finally(() => inFlight.delete(q));
    inFlight.add(q);
    return q;
  };

  const llmLoop = async (): Promise<void> => {
    while (!shuttingDown) {
      try {
        const tasks = await fetchLlmTasks(creds, agentId);
        for (let i = 0; i < tasks.length && !shuttingDown; i += CONCURRENCY) {
          const chunk = tasks.slice(i, i + CONCURRENCY);
          if (verbose) for (const t of chunk) console.log(`  ↳ llm ${sanitizeTerminal(t.id)} model=${sanitizeTerminal(t.modelId)}`);
          await Promise.all(
            chunk.map((t) => track(runOneTask(creds, agentId, t, ollamaBaseUrl, verbose))),
          ).catch(() => {});
        }
      } catch (e) {
        if (e instanceof AuthError) {
          onAuthError(e);
          break;
        }
        if (verbose) console.error("[llm-poll]", e instanceof Error ? e.message : String(e));
      }
      if (!shuttingDown) await sleep(POLL_INTERVAL_MS);
    }
  };

  const searchLoop = async (): Promise<void> => {
    while (!shuttingDown) {
      try {
        const tasks = await fetchSearchTasks(creds, agentId);
        for (let i = 0; i < tasks.length && !shuttingDown; i += CONCURRENCY) {
          const chunk = tasks.slice(i, i + CONCURRENCY);
          await Promise.all(
            chunk.map((t) => track(runSearchTask(creds, agentId, t, watchedRepos, verbose))),
          ).catch(() => {});
        }
      } catch (e) {
        if (e instanceof AuthError) {
          onAuthError(e);
          break;
        }
        if (verbose) console.error("[search-poll]", e instanceof Error ? e.message : String(e));
      }
      if (!shuttingDown) await sleep(POLL_INTERVAL_MS);
    }
  };

  console.log(`Polling every ${POLL_INTERVAL_MS / 1000}s (concurrency=${CONCURRENCY}). Ctrl+C to stop.`);
  await Promise.all([...(doLlm ? [llmLoop()] : []), ...(doSearch ? [searchLoop()] : [])]);

  if (heartbeat) clearInterval(heartbeat);
  await postJson(`${creds.baseUrl}/api/agent/disconnect`, { agentId }, creds.token).catch(() => {});
  return exitCode;
}

async function checkOllama(ollamaBaseUrl: string): Promise<boolean> {
  try {
    const r = await fetch(`${ollamaBaseUrl}/api/tags`);
    return r.ok;
  } catch {
    return false;
  }
}

async function registerAgent(
  creds: Credentials,
  agentName: string,
  repoFullNames: string[],
  capabilities: string[],
) {
  return await postJson<AgentRegisterResponse>(
    `${creds.baseUrl}/api/agent/register`,
    {
      name: agentName,
      // repoFullNames scopes which code-search tasks the server routes here
      // (empty when serving LLM-only). The server requires an array either way.
      repoFullNames,
      capabilities,
      machineInfo: {
        os: process.platform,
        hostname: process.env.HOSTNAME ?? "",
        nodeVersion: process.version,
      },
    },
    creds.token,
  );
}

// Raised by fetchLlmTasks / fetchSearchTasks on auth failure (401/403, plus 404
// for a revoked agent). The polling loops check for this and exit — retrying a
// revoked or expired token would never recover and would spam the server
// indefinitely.
class AuthError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function fetchLlmTasks(creds: Credentials, agentId: string): Promise<LlmTask[]> {
  const res = await getJson<{ tasks: LlmTask[] }>(
    `${creds.baseUrl}/api/agent/llm-tasks?agentId=${encodeURIComponent(agentId)}`,
    {
      headers: { authorization: `Bearer ${creds.token}` },
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
    },
  );
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new AuthError(res.status, res.error);
    }
    // 404 = the agent's LocalAgent row no longer exists — the operator
    // revoked it via DELETE /api/agent/[id]. Retrying would 404 forever
    // (the row's gone, the token may even still work). Surface as AuthError
    // so the polling loop exits with the actionable "restart to re-register"
    // message instead of silently spinning until the user notices.
    if (res.status === 404) {
      throw new AuthError(
        res.status,
        "This agent was revoked from the dashboard. Re-running `octp agent serve` " +
          "creates a fresh registration (it is not retrying the failed call) — confirm in the " +
          "dashboard's Local Agents page that the revocation was intentional first; otherwise " +
          "the new registration will be revoked again.",
      );
    }
    throw new Error(res.error);
  }
  return res.data.tasks;
}

async function runOneTask(
  creds: Credentials,
  agentId: string,
  task: LlmTask,
  ollamaBaseUrl: string,
  verbose: boolean,
): Promise<void> {
  const completeUrl = `${creds.baseUrl}/api/agent/llm-tasks/${task.id}/complete`;
  try {
    if (!task.modelId.startsWith("ollama:") && !task.modelId.includes(":")) {
      // Not an Ollama-prefixed model and not bare — assume Ollama anyway,
      // but log so the user knows what's happening.
      if (verbose) console.log(`  (assuming Ollama for unprefixed model "${sanitizeTerminal(task.modelId)}")`);
    }
    const model = task.modelId.startsWith("ollama:") ? task.modelId.slice(7) : task.modelId;

    const messages: { role: string; content: string }[] = [];
    if (task.system) messages.push({ role: "system", content: task.system });
    for (const m of task.messages) messages.push({ role: m.role, content: m.content });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${ollamaBaseUrl}/v1/chat/completions`, {
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
    //
    // postJson never rejects — it resolves {ok:false} on HTTP/network errors.
    // Failing to deliver the result must be loud (the work is lost, the
    // server-side task stays "claimed" until the provider's 5-minute timeout
    // fails the review). Capture the result and log + throw on !ok so the
    // outer catch posts the error to /complete for fast surface.
    const deliver = await postJson(
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
    if (!deliver.ok) {
      throw new Error(
        `failed to deliver result to /complete (HTTP ${deliver.status}: ${deliver.error})`,
      );
    }
    if (verbose) console.log(`  ✓ completed ${sanitizeTerminal(task.id)} (${text.length} chars)`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  ✗ failed ${sanitizeTerminal(task.id)}: ${sanitizeTerminal(msg)}`);
    // Best-effort error-side delivery. postJson resolves {ok:false} so the
    // catch is technically dead today, but harmless and defends against
    // a future change.
    await postJson(completeUrl, { agentId, error: msg }, creds.token).catch(() => {});
  }
}

async function fetchSearchTasks(creds: Credentials, agentId: string): Promise<SearchTask[]> {
  const res = await getJson<{ tasks: SearchTask[] }>(
    `${creds.baseUrl}/api/agent/tasks?agentId=${encodeURIComponent(agentId)}`,
    {
      headers: { authorization: `Bearer ${creds.token}` },
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
    },
  );
  if (!res.ok) {
    // 401/403 = bad token; 404 = agent revoked. None recover by retrying — the
    // poll loop converts AuthError into a clean exit (same as the LLM queue).
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      throw new AuthError(res.status, res.error);
    }
    throw new Error(res.error);
  }
  return res.data.tasks ?? [];
}

async function runSearchTask(
  creds: Credentials,
  agentId: string,
  task: SearchTask,
  watchedRepos: Map<string, string>,
  verbose: boolean,
): Promise<void> {
  const claimUrl = `${creds.baseUrl}/api/agent/tasks/${task.id}/claim`;
  const resultUrl = `${creds.baseUrl}/api/agent/tasks/${task.id}/result`;

  // Claim first — the server makes this atomic; 409 means another agent won.
  const claim = await postJson(claimUrl, { agentId }, creds.token);
  if (!claim.ok) {
    if (claim.status === 409) return; // lost the race — normal, not an error
    if (verbose)
      console.error(
        `  search claim failed ${sanitizeTerminal(task.id)}: HTTP ${claim.status} ${sanitizeTerminal(claim.error)}`,
      );
    return;
  }

  const repoDir = watchedRepos.get(task.repoFullName);
  if (!repoDir) {
    await postJson(
      resultUrl,
      { errorMessage: `agent no longer watches ${task.repoFullName}` },
      creds.token,
    ).catch(() => {});
    return;
  }

  try {
    if (verbose) {
      console.log(
        `  ↳ search ${sanitizeTerminal(task.id)} (${sanitizeTerminal(task.searchType)}) · ${sanitizeTerminal(task.repoFullName)}`,
      );
    }
    const params = task.params && typeof task.params === "object" ? task.params : {};
    const { results, summary } = await runCodeSearch(
      task.searchType,
      task.query,
      params,
      repoDir,
      task.timeoutMs,
    );
    const deliver = await postJson(resultUrl, { results, resultSummary: summary }, creds.token);
    if (!deliver.ok) {
      throw new Error(`deliver failed (HTTP ${deliver.status}: ${deliver.error})`);
    }
    if (verbose) console.log(`  ✓ search ${sanitizeTerminal(task.id)}: ${results.length} hit(s)`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (verbose) console.error(`  ✗ search ${sanitizeTerminal(task.id)}: ${sanitizeTerminal(msg)}`);
    await postJson(resultUrl, { errorMessage: msg.slice(0, 500) }, creds.token).catch(() => {});
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
  // process.env.HOSTNAME is unset in most macOS/Linux shells (zsh exports
  // HOST, not HOSTNAME; node doesn't pull it in either), so the previous
  // default "agent-<pid>" changed every restart and the server's upsert
  // on (org, name) never reused the row. Using os.hostname() (the OS-level
  // hostname) keeps the same machine's agent row stable across restarts —
  // matches the file's own "reuse existing by name" lifecycle comment.
  // Drop the pid suffix for the same reason.
  //
  // Trade-off: two agents on the SAME host will collide on this default
  // (each one's heartbeat overwrites the other's row, and dispatch routes
  // to whichever heartbeated last). Operators running multi-agent setups
  // on one host must pass `--name <distinguishing-suffix>` — the startup
  // banner below logs the chosen name so the collision is visible.
  return os.hostname() || "agent";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
