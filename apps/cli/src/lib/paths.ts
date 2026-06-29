import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";

/**
 * Resolve the Octopus home directory.
 * Override via `OCTOPUS_HOME` (trusted operator/test config) for non-standard
 * installs. The override is resolved to an absolute path so a relative or
 * `..`-containing value can't land config/credentials somewhere surprising
 * relative to the current working directory.
 */
export function getOctopusHome(): string {
  const override = process.env.OCTOPUS_HOME;
  if (override) return resolve(override);
  return join(homedir(), ".octopus");
}

export function getConfigPath(): string {
  return join(getOctopusHome(), "config.json");
}

export function getByokPath(): string {
  return join(getOctopusHome(), "byok.json");
}

export function getCredentialsPath(): string {
  return join(getOctopusHome(), "credentials");
}

/**
 * Ensure the Octopus home directory exists with restrictive permissions.
 * Idempotent — safe to call on every launch.
 */
export async function ensureOctopusHome(): Promise<void> {
  await mkdir(getOctopusHome(), { recursive: true, mode: 0o700 });
}
