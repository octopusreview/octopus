import { readFile, writeFile } from "node:fs/promises";
import { ensureOctopusHome, getConfigPath } from "./paths.js";

/**
 * Bumped when the on-disk shape changes. An older or unparseable file is
 * treated as missing — the wizard re-runs instead of crashing on a stale file.
 */
export const CONFIG_VERSION = 1;

export type OctopusConfig = {
  version: number;
  /** ISO timestamp of when the user completed the wizard. Presence gates first-run. */
  onboardedAt?: string;
  /** Provider slug chosen during onboarding ("anthropic" | "openai" | "google" | …). */
  provider?: string;
  /** Model ID chosen during onboarding (e.g. "claude-sonnet-4-6-20250619", "gpt-4o"). */
  model?: string;
  /** Hosted API base URL when self-hosting. Absent when using the SaaS. */
  selfHostedBaseUrl?: string;
  /**
   * Custom Ollama base URL. Only set when the user picked Ollama in the wizard
   * AND overrode the default. `octp agent serve` reads this — env var
   * OLLAMA_BASE_URL still wins, then this, then the built-in default
   * `http://localhost:11434`.
   */
  ollamaBaseUrl?: string;
};

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

/**
 * One-shot remap for Anthropic model IDs persisted by older CLI versions.
 * The pre-dated-IDs catalog wrote `claude-sonnet-4-6` / `claude-opus-4-7` /
 * `claude-haiku-4-5` to ~/.octopus/config.json, but those strings are NOT in
 * the server's exact-key pricing map, so usage logged under them prices to
 * $0 and bypasses the org spend-limit check — the exact bypass the catalog
 * fix was meant to close. Bumping CONFIG_VERSION would force re-onboarding
 * (worse UX); a silent remap on load keeps users billable without surprise.
 *
 * Safe to leave in indefinitely: the new IDs ARE the canonical Anthropic
 * model IDs, so re-saving the config writes the dated form back to disk.
 */
const LEGACY_MODEL_REMAP: Record<string, string> = {
  "claude-sonnet-4-6": "claude-sonnet-4-6-20250619",
  "claude-opus-4-7": "claude-opus-4-6-20250619",
  "claude-haiku-4-5": "claude-haiku-4-5-20251001",
};

const EMPTY: OctopusConfig = { version: CONFIG_VERSION };

/**
 * Load the config. Returns an empty (un-onboarded) config when the file is
 * missing, unreadable, unparseable, or has a different version — never throws
 * for filesystem or schema reasons. The wizard treats all of these as "needs
 * to re-run".
 */
export async function loadConfig(): Promise<OctopusConfig> {
  try {
    const raw = await readFile(getConfigPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      (parsed as OctopusConfig).version === CONFIG_VERSION
    ) {
      const cfg = parsed as OctopusConfig;
      if (cfg.model && LEGACY_MODEL_REMAP[cfg.model]) {
        cfg.model = LEGACY_MODEL_REMAP[cfg.model];
      }
      return cfg;
    }
    return { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

/**
 * Persist the config with restrictive permissions. Creates the home dir if it
 * doesn't exist. Stamps `onboardedAt` to now when missing OR when the
 * incoming value is unparseable / in the future (a tampered config file
 * could otherwise pin a bogus future date that would never become "stale"
 * by any time-based logic downstream).
 */
export async function saveConfig(next: OctopusConfig): Promise<void> {
  await ensureOctopusHome();
  const out: OctopusConfig = {
    ...next,
    version: CONFIG_VERSION,
    onboardedAt: stableOnboardedAt(next.onboardedAt),
  };
  await writeFile(getConfigPath(), JSON.stringify(out, null, 2), { mode: 0o600 });
}

function stableOnboardedAt(incoming: string | undefined): string {
  if (!incoming) return new Date().toISOString();
  const parsed = new Date(incoming).getTime();
  // Reject unparseable timestamps + anything more than 60s in the future
  // (small grace for clock skew between machines). The threshold is
  // deliberately small — onboardedAt is a personal-machine artifact, not
  // a distributed log.
  if (Number.isNaN(parsed) || parsed > Date.now() + 60_000) {
    return new Date().toISOString();
  }
  return incoming;
}

export function isOnboarded(c: OctopusConfig): boolean {
  return Boolean(c.onboardedAt);
}
