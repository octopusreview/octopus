import { loadConfig, isOnboarded, DEFAULT_OLLAMA_BASE_URL } from "../lib/config.js";
import { loadCredentials } from "../lib/credentials.js";
import { loadByok } from "../lib/byok.js";
import { getJson } from "../lib/api.js";
import { getOctopusHome } from "../lib/paths.js";
import { sanitizeTerminal } from "../lib/output.js";

/**
 * `octp doctor` — environment + auth health check. Prints one line per
 * check: ✓ ok, ⚠ degraded, ✗ broken, · skipped (not configured).
 *
 * Designed for two audiences:
 *   - Developers troubleshooting their CLI install ("why doesn't `octp`
 *     work" — doctor names the broken link)
 *   - Bug reports ("paste the doctor output" lets us see config without
 *     leaking the actual credential values)
 *
 * The output is intentionally machine-parseable for the latter: every
 * line starts with one of the four status glyphs.
 */
export async function doctorCommand(_argv: string[]): Promise<number> {
  let hadError = false;

  const line = (status: "ok" | "warn" | "error" | "skip", label: string, detail?: string) => {
    const glyph = { ok: "✓", warn: "⚠", error: "✗", skip: "·" }[status];
    console.log(`${glyph} ${label}${detail ? ` — ${detail}` : ""}`);
    if (status === "error") hadError = true;
  };

  console.log("octp doctor");
  console.log("─".repeat(40));

  // ── Config ─────────────────────────────────────────────────────────────────
  console.log("\nConfig:");
  const config = await loadConfig();
  line("ok", `${getOctopusHome()}/config.json`, isOnboarded(config) ? "onboarded" : "not yet onboarded");
  if (config.provider) line("ok", "provider", config.provider);
  else line("warn", "provider", "not chosen — run `octp onboard`");
  if (config.model) line("ok", "model", config.model);
  else line("warn", "model", "not chosen");
  if (config.selfHostedBaseUrl) line("ok", "self-hosted base URL", config.selfHostedBaseUrl);
  else line("skip", "self-hosted base URL", "using hosted (octopus-review.ai)");

  // ── Credentials ────────────────────────────────────────────────────────────
  console.log("\nAuth:");
  const creds = await loadCredentials();
  if (!creds) {
    line("warn", "credentials", "no ~/.octopus/credentials — run `octp` to sign in");
  } else {
    line(
      "ok",
      "credentials",
      `${sanitizeTerminal(creds.orgName)} (${sanitizeTerminal(creds.orgSlug)}) on ${sanitizeTerminal(creds.baseUrl)}`,
    );

    // Live token check — hits /api/cli/me with the saved bearer.
    const res = await getJson(`${creds.baseUrl}/api/cli/me`, {
      headers: { authorization: `Bearer ${creds.token}` },
    });
    if (res.ok) line("ok", "token", "accepted by server");
    else if (res.status === 401) line("error", "token", "rejected (401) — re-sign in with `octp onboard`");
    else if (res.status === 0) line("error", "token", `network error: ${res.error}`);
    else line("warn", "token", `unexpected HTTP ${res.status}`);
  }

  // ── BYOK keys ──────────────────────────────────────────────────────────────
  console.log("\nBYOK keys (~/.octopus/byok.json):");
  const byok = await loadByok();
  const keys = Object.keys(byok.keys);
  if (keys.length === 0) {
    line("skip", "no provider keys saved", "using platform keys via the org");
  } else {
    for (const provider of keys) {
      const len = byok.keys[provider]?.length ?? 0;
      line("ok", provider, `${len}-char key (last edited ${byok.updatedAt ?? "?"})`);
    }
  }

  // ── Ollama (if relevant) ───────────────────────────────────────────────────
  console.log("\nOllama:");
  if (config.provider !== "ollama") {
    line("skip", "not selected provider");
  } else {
    // URL precedence matches agent-serve / validate (per config.ts:20-28):
    // env wins, then wizard-saved ollamaBaseUrl, then default.
    const base =
      process.env.OLLAMA_BASE_URL ?? config.ollamaBaseUrl ?? DEFAULT_OLLAMA_BASE_URL;
    try {
      const r = await fetch(`${base}/api/tags`);
      if (r.ok) {
        const data = (await r.json()) as { models?: { name?: string }[] };
        const count = data.models?.length ?? 0;
        line("ok", `reachable at ${base}`, `${count} local model${count === 1 ? "" : "s"}`);
      } else {
        line("error", `reachable at ${base}`, `HTTP ${r.status}`);
      }
    } catch (e) {
      line("error", `reachable at ${base}`, `${e instanceof Error ? e.message : String(e)}; try \`ollama serve\``);
    }
  }

  // ── Local agent registration (if any) ──────────────────────────────────────
  if (creds) {
    console.log("\nLocal agents for this org:");
    // /api/agent/status requires `orgId` as a query param and 400s without
    // it. The endpoint already filters to agents with a fresh heartbeat,
    // so any agent it returns is considered live — no need to inspect a
    // per-agent `status` field (the endpoint doesn't return one anyway).
    const url = `${creds.baseUrl}/api/agent/status?orgId=${encodeURIComponent(creds.orgId)}`;
    const res = await getJson<{ agents: { id: string; name: string; lastSeenAt: string | null }[] }>(
      url,
      { headers: { authorization: `Bearer ${creds.token}` } },
    );
    if (!res.ok) {
      line("warn", "agent status unavailable", res.error);
    } else if (res.data.agents.length === 0) {
      line("skip", "no agents registered", "run `octp agent serve` to register one");
    } else {
      for (const a of res.data.agents) {
        line("ok", a.name, `online${a.lastSeenAt ? ` (last seen ${a.lastSeenAt})` : ""}`);
      }
    }
  }

  console.log("\n" + "─".repeat(40));
  if (hadError) {
    console.log("Some checks failed. Fix the ✗ items above.");
    return 1;
  }
  console.log("All checks passed.");
  return 0;
}
