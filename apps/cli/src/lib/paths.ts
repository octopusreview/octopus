import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

/**
 * Resolve the Octopus home directory.
 * Override via `OCTOPUS_HOME` for tests and non-standard installs.
 */
export function getOctopusHome(): string {
  const override = process.env.OCTOPUS_HOME;
  if (override) return override;
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
