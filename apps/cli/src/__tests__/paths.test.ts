import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import {
  ensureOctopusHome,
  getByokPath,
  getConfigPath,
  getCredentialsPath,
  getOctopusHome,
} from "../lib/paths";

let tmpHome: string;

beforeEach(async () => {
  tmpHome = await mkdtemp(join(tmpdir(), "octp-paths-"));
  process.env.OCTOPUS_HOME = tmpHome;
});

afterEach(async () => {
  delete process.env.OCTOPUS_HOME;
  await rm(tmpHome, { recursive: true, force: true });
});

describe("getOctopusHome", () => {
  it("honors OCTOPUS_HOME when set", () => {
    expect(getOctopusHome()).toBe(tmpHome);
  });

  it("falls back to ~/.octopus when OCTOPUS_HOME is unset", () => {
    delete process.env.OCTOPUS_HOME;
    const home = getOctopusHome();
    // Use platform-aware separator instead of "/.octopus" so the test
    // also passes on Windows where path.join produces "\.octopus".
    expect(home.endsWith(`${sep}.octopus`)).toBe(true);
  });
});

describe("path helpers", () => {
  it("keeps config global; puts byok + credentials under the active profile dir", () => {
    // No profiles.json yet → active profile resolves to "default".
    expect(getConfigPath()).toBe(join(tmpHome, "config.json"));
    expect(getByokPath()).toBe(join(tmpHome, "profiles", "default", "byok.json"));
    expect(getCredentialsPath()).toBe(join(tmpHome, "profiles", "default", "credentials"));
  });
});

describe("ensureOctopusHome", () => {
  it("creates the directory if absent", async () => {
    await rm(tmpHome, { recursive: true, force: true });
    await ensureOctopusHome();
    const st = await stat(tmpHome);
    expect(st.isDirectory()).toBe(true);
  });

  it("is idempotent — no error when the directory already exists", async () => {
    await ensureOctopusHome();
    await ensureOctopusHome();
    const st = await stat(tmpHome);
    expect(st.isDirectory()).toBe(true);
  });
});
