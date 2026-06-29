import { chmod, readFile, writeFile } from "node:fs/promises";
import { ensureOctopusHome, getByokPath } from "./paths.js";

/**
 * Provider API keys live in a separate file from `config.json` so the prefs
 * file stays "safe to cat" while keys are protected as their own secret.
 * File permissions: 0600 in a 0700 directory.
 */
export type ByokFile = {
  /** Map of provider slug ("anthropic" | "openai" | "google" | …) to API key. */
  keys: Record<string, string>;
  /** ISO timestamp of the most recent key edit. */
  updatedAt?: string;
};

const EMPTY: ByokFile = { keys: {} };

export async function loadByok(): Promise<ByokFile> {
  try {
    const raw = await readFile(getByokPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    // `typeof null === "object"` and `typeof [] === "object"`, so the
    // existing shape guard accepted both `{"keys": null}` and `{"keys": []}`.
    // Either form crashed downstream (`byok.keys[provider]` on null →
    // TypeError; `provider in []` is fine but `Object.keys` on an array
    // returned indices). Fall back to EMPTY in both cases.
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "keys" in parsed &&
      (parsed as ByokFile).keys !== null &&
      typeof (parsed as ByokFile).keys === "object" &&
      !Array.isArray((parsed as ByokFile).keys)
    ) {
      return parsed as ByokFile;
    }
    return { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

export async function setByokKey(provider: string, apiKey: string): Promise<void> {
  await ensureOctopusHome();
  const current = await loadByok();
  const next: ByokFile = {
    keys: { ...current.keys, [provider]: apiKey },
    updatedAt: new Date().toISOString(),
  };
  const p = getByokPath();
  await writeFile(p, JSON.stringify(next, null, 2), { mode: 0o600 });
  // writeFile's `mode` only applies on FILE CREATION. If byok.json already
  // existed with looser permissions (older build, restored from a sync
  // tool, touched under a different umask), rewriting it leaves the loose
  // bits intact. Force-chmod after every write so the documented 0600
  // promise actually holds on pre-existing files too.
  await chmod(p, 0o600);
}

export async function clearByokKey(provider: string): Promise<void> {
  const current = await loadByok();
  if (!(provider in current.keys)) return;
  const { [provider]: _removed, ...rest } = current.keys;
  await writeFile(
    getByokPath(),
    JSON.stringify({ keys: rest, updatedAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 },
  );
}
