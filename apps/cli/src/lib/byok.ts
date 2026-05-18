import { readFile, writeFile } from "node:fs/promises";
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
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "keys" in parsed &&
      typeof (parsed as ByokFile).keys === "object"
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
  await writeFile(getByokPath(), JSON.stringify(next, null, 2), { mode: 0o600 });
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
