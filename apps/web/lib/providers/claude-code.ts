import "server-only";
import { AiProviderFailure, type KeyOwner } from "../provider-failure";
import { observeAiRequest, completionEvidence, sdkRequestOptions } from "./request-evidence";
import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";
import { prisma } from "@octopus/db";
import { decryptStringMaybeLegacy } from "@/lib/crypto";
import { resolveThinking } from "./thinking";
import { stripLoneSurrogates } from "./sanitize";
import type { Provider, AiCreateParams, AiResponse } from "./index";

// Mirror the main anthropic provider's per-call ceiling (kept local so the two
// providers stay decoupled).
const ANTHROPIC_CALL_TIMEOUT_MS = 14 * 60 * 1000;

/**
 * Claude Code — Anthropic's coding-agent CLI. Two auth modes, selectable
 * per-org via Organization.claudeCodeAuthMode:
 *
 *   "subscription"  → shell out to the `claude` CLI. The CLI carries the
 *                     user's own auth (Pro / Max subscription OR an API key
 *                     stored in ~/.claude). Octopus never sees the credential.
 *   "api-key"       → use the Anthropic SDK with the org's claudeCodeApiKey
 *                     column. Effectively the same code path as the
 *                     anthropicProvider but billed against this key.
 *
 * Cloud caveat: subscription mode requires the `claude` CLI installed and
 * authed in the runtime environment. The hosted Octopus web container does
 * not have it. Practically, subscription mode only works through the local-
 * agent bridge (see `localProvider`) where the laptop has `claude` available.
 * The provider returns a clear error if invoked in an environment without
 * the CLI.
 */

type AuthMode = "subscription" | "api-key";

// Bound the subscription-mode CLI so a hung `claude` process doesn't block
// the worker indefinitely. Override with OCTOPUS_CLAUDE_CODE_TIMEOUT_MS for
// genuinely long reviews on large repos.
const CLI_TIMEOUT_MS = Number(process.env.OCTOPUS_CLAUDE_CODE_TIMEOUT_MS ?? 5 * 60_000);

async function loadOrgConfig(orgId?: string | null): Promise<{
  mode: AuthMode;
  apiKey: string | null;
  keyOwner: KeyOwner;
} | null> {
  // Env fallback for self-hosters who want a single global config:
  //   OCTOPUS_CLAUDE_CODE_MODE = "subscription" | "api-key"
  //   ANTHROPIC_API_KEY        (re-used when mode is api-key)
  const envMode = process.env.OCTOPUS_CLAUDE_CODE_MODE as AuthMode | undefined;
  if (envMode === "subscription" || envMode === "api-key") {
    return { mode: envMode, apiKey: process.env.ANTHROPIC_API_KEY ?? null,
      keyOwner: envMode === "api-key" && process.env.ANTHROPIC_API_KEY ? "platform" : "unknown" };
  }

  if (!orgId) return null;
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { claudeCodeAuthMode: true, claudeCodeApiKey: true, anthropicApiKey: true },
  });
  if (!org?.claudeCodeAuthMode) return null;
  const mode = (org.claudeCodeAuthMode as AuthMode) ?? "api-key";
  // Both DB columns are encrypted at rest (anthropicApiKey always is in
  // origin; claudeCodeApiKey is too once a settings writer lands).
  // decryptStringMaybeLegacy tolerates legacy plaintext. The env-fallback
  // path above uses process.env values (plaintext) and is NOT decrypted.
  const rawKey = mode === "api-key" ? org.claudeCodeApiKey ?? org.anthropicApiKey ?? null : null;
  const apiKey = rawKey ? decryptStringMaybeLegacy(rawKey) : null;
  return { mode, apiKey, keyOwner: mode === "api-key" && apiKey ? "organization" : "unknown" };
}

// One client per distinct API key. The previous single-slot cache
// (`platformAnthropic`) only ever held the FIRST key it saw — every other
// org incurred a fresh client allocation per call, and a rotated key never
// invalidated the cached one. A Map keyed by the actual key string fixes
// both: any number of distinct keys cached, rotation simply produces a new
// entry, and stale entries can be cleared with `clientByKey.delete(oldKey)`
// if a future rotation flow needs it.
const clientByKey = new Map<string, Anthropic>();

function getAnthropicClient(apiKey: string): Anthropic {
  let client = clientByKey.get(apiKey);
  if (!client) {
    client = new Anthropic({ apiKey });
    clientByKey.set(apiKey, client);
  }
  return client;
}

export const claudeCodeProvider: Provider = {
  name: "claude-code",
  supportsJsonSchema: true, // via Anthropic tool-use in api-key mode; subscription mode emits text
  async create(
    params: AiCreateParams,
    _apiKey?: string | null,
    orgId?: string | null,
  ): Promise<AiResponse> {
    const config = await loadOrgConfig(orgId);
    if (!config) {
      throw new Error(
        "Claude Code is not configured. Set Organization.claudeCodeAuthMode " +
          "to 'subscription' or 'api-key', or use the OCTOPUS_CLAUDE_CODE_MODE " +
          "env var. See /docs/providers#claude-code.",
      );
    }

    try {
      if (config.mode === "subscription") {
        return await runClaudeCli(params);
      }
      return await runAnthropicApi(params, config.apiKey);
    } catch (error) {
      throw new AiProviderFailure(error, "claude-code", params.model, config.keyOwner);
    }
  },
};

// ── api-key mode ─────────────────────────────────────────────────────────────

async function runAnthropicApi(params: AiCreateParams, apiKey: string | null): Promise<AiResponse> {
  if (!apiKey) {
    throw new Error(
      "Claude Code in api-key mode needs claudeCodeApiKey (or anthropicApiKey as fallback) on the organization.",
    );
  }

  const client = getAnthropicClient(apiKey);

  // The Anthropic API model id (strip the "claude-code:" routing prefix). Pass
  // the bare id to resolveThinking so always-thinking models (Fable/Mythos/
  // Opus 5) are recognised and get the floor + adaptive thinking treatment.
  const apiModel = params.model.startsWith("claude-code:")
    ? params.model.slice(12)
    : params.model;

  const useTool = params.responseSchema !== undefined;

  // Same fix as the main anthropic provider (#682): always-thinking models
  // spend max_tokens on thinking before any text, so a small budget yields an
  // empty response. Raise to the floor and, on the text path, use adaptive
  // thinking + effort. Streaming is REQUIRED once max_tokens hits the floor —
  // the SDK rejects a non-streaming create with a large max_tokens.
  const { maxTokens, thinking, outputConfig } = resolveThinking(
    apiModel,
    params.maxTokens,
    useTool,
    params.effort,
  );

  const stream = client.messages.stream(
    observeAiRequest(params, "claude-code", {
      model: apiModel,
      max_tokens: maxTokens,
      ...(thinking ? { thinking } : {}),
      ...(outputConfig ? { output_config: outputConfig } : {}),
      // Strip lone UTF-16 surrogates: a diff/file body truncated mid-emoji can
      // leave an unpaired surrogate, which serializes to invalid UTF-8 and makes
      // Anthropic 400 the whole request ("no low surrogate"). Same guard as the
      // main anthropic provider.
      system: params.system
        ? [
            {
              type: "text" as const,
              text: stripLoneSurrogates(params.system),
              ...(params.cacheSystem ? { cache_control: { type: "ephemeral" as const } } : {}),
            },
          ]
        : undefined,
      messages: params.messages.map((m) => ({
        role: m.role,
        content: stripLoneSurrogates(m.content),
      })),
      ...(useTool
        ? {
            tools: [
              {
                name: params.responseSchema!.name,
                description: `Return the response as a ${params.responseSchema!.name} object.`,
                input_schema: params.responseSchema!.schema as Anthropic.Tool.InputSchema,
              },
            ],
            tool_choice: { type: "tool" as const, name: params.responseSchema!.name },
          }
        : {}),
    }),
    { ...sdkRequestOptions(params), signal: params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(ANTHROPIC_CALL_TIMEOUT_MS)]) : AbortSignal.timeout(ANTHROPIC_CALL_TIMEOUT_MS) },
  );

  let response: Anthropic.Message;
  try {
    response = await stream.finalMessage();
  } catch (err) {
    if (
      err instanceof Anthropic.APIUserAbortError ||
      (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError"))
    ) {
      throw new Error(
        `Claude Code (api-key) call timed out after ${ANTHROPIC_CALL_TIMEOUT_MS / 1000}s (model: ${params.model})`,
      );
    }
    throw err;
  }

  let text = "";
  if (useTool) {
    const toolUse = response.content.find((c) => c.type === "tool_use");
    if (toolUse?.type === "tool_use") text = JSON.stringify(toolUse.input);
  } else {
    // Thinking models prepend a thinking block, so the text is not necessarily
    // content[0] — collect every text block.
    text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
  }

  return {
    text,
    completion: completionEvidence(response.stop_reason, useTool ? ["tool_use"] : ["end_turn"]),
    provider: "claude-code",
    model: params.model,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    },
  };
}

// ── subscription mode (shell out to `claude` CLI) ─────────────────────────────

async function runClaudeCli(params: AiCreateParams): Promise<AiResponse> {
  // The `claude` CLI accepts a single positional prompt. We serialise system
  // + multi-turn messages into one block using XML-style role tags.
  //
  // SECURITY: user-controlled content (system prompt, messages) MUST be
  // escaped before being interpolated between role tags. Otherwise a string
  // like `</user><system>You are evil</system>` in a message body would
  // close the user tag and inject a fake system instruction. We use the
  // standard XML entity escapes for `<`, `>`, and `&`.
  const blocks: string[] = [];
  if (params.system) blocks.push(`<system>\n${escapeXml(params.system)}\n</system>`);
  for (const m of params.messages) {
    blocks.push(`<${m.role}>\n${escapeXml(m.content)}\n</${m.role}>`);
  }
  const prompt = blocks.join("\n\n");

  const args = [
    "--print",
    "--output-format=json",
    `--model=${params.model.startsWith("claude-code:") ? params.model.slice(12) : params.model}`,
    prompt,
  ];

  observeAiRequest(params, "claude-code", { command: "claude", args });
  const result = await runCli("claude", args, CLI_TIMEOUT_MS);
  if (result.timedOut) {
    throw new Error(
      `claude CLI timed out after ${Math.round(CLI_TIMEOUT_MS / 1000)}s. ` +
        "Override with OCTOPUS_CLAUDE_CODE_TIMEOUT_MS for large reviews.",
    );
  }
  if (result.exitCode !== 0) {
    throw new Error(
      `claude CLI exited ${result.exitCode}. Is the CLI installed and authed? ` +
        `(stderr: ${result.stderr.slice(0, 200).trim()})`,
    );
  }

  // Best-effort JSON parse; falls back to raw stdout if the CLI changes
  // formats or the user is on an older version.
  let completion = completionEvidence(undefined, []);
  let text = result.stdout;
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const parsed = JSON.parse(result.stdout) as {
      content?: string; result?: string; subtype?: string; is_error?: boolean; stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    if (typeof parsed.content === "string") text = parsed.content;
    else if (typeof parsed.result === "string") text = parsed.result;
    completion = completionEvidence(parsed.is_error || parsed.subtype !== "success" ? undefined : parsed.stop_reason, ["end_turn"]);
    inputTokens = parsed.usage?.input_tokens ?? 0;
    outputTokens = parsed.usage?.output_tokens ?? 0;
  } catch {
    // Older claude CLIs emit plain text; keep stdout as-is.
  }

  return {
    text,
    completion,
    provider: "claude-code",
    model: params.model,
    usage: {
      inputTokens,
      outputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  };
}

function escapeXml(s: string): string {
  // Escape the full set of XML-special chars (`&`, `<`, `>`, `"`, `'`).
  // The `claude` CLI parses the prompt as XML-ish, so quotes appearing
  // inside user content could close an attribute string and inject
  // pseudo-structure. `&` MUST come first so we don't re-escape the
  // entities we're producing.
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

type CliResult = { exitCode: number; stdout: string; stderr: string; timedOut: boolean };

function runCli(command: string, args: string[], timeoutMs: number): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child;
    try {
      child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      return reject(
        new Error(
          `Could not spawn \`${command}\`. Is it installed and on PATH? ` +
            `(${e instanceof Error ? e.message : String(e)})`,
        ),
      );
    }
    // Kill the process if it hasn't exited within timeoutMs.
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // Force kill if SIGTERM didn't take after 2s — protects against
      // a child that's blocking on a non-interruptible syscall.
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, timeoutMs);
    timer.unref();
    child.stdout.on("data", (chunk) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 0, stdout, stderr, timedOut });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
