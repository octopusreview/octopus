import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_VERSION, isOnboarded, loadConfig, saveConfig } from "../lib/config";

let tmpHome: string;

beforeEach(async () => {
  tmpHome = await mkdtemp(join(tmpdir(), "octp-cfg-"));
  process.env.OCTOPUS_HOME = tmpHome;
});

afterEach(async () => {
  delete process.env.OCTOPUS_HOME;
  await rm(tmpHome, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns an empty config when the file is missing", async () => {
    const c = await loadConfig();
    expect(c.version).toBe(CONFIG_VERSION);
    expect(c.onboardedAt).toBeUndefined();
    expect(isOnboarded(c)).toBe(false);
  });

  it("returns an empty config when the file is unparseable", async () => {
    await writeFile(join(tmpHome, "config.json"), "{ not json");
    const c = await loadConfig();
    expect(c.version).toBe(CONFIG_VERSION);
    expect(isOnboarded(c)).toBe(false);
  });

  it("returns an empty config when the file has a stale version", async () => {
    await writeFile(
      join(tmpHome, "config.json"),
      JSON.stringify({ version: 0, onboardedAt: "2020-01-01" }),
    );
    const c = await loadConfig();
    expect(c.version).toBe(CONFIG_VERSION);
    expect(c.onboardedAt).toBeUndefined();
  });

  it("returns the saved config when version matches", async () => {
    await writeFile(
      join(tmpHome, "config.json"),
      JSON.stringify({
        version: CONFIG_VERSION,
        onboardedAt: "2026-05-17T00:00:00.000Z",
        provider: "anthropic",
      }),
    );
    const c = await loadConfig();
    expect(c.provider).toBe("anthropic");
    expect(isOnboarded(c)).toBe(true);
  });

  it("remaps legacy undated Anthropic model IDs to the dated forms", async () => {
    const cases: Array<[string, string]> = [
      ["claude-sonnet-4-6", "claude-sonnet-4-6-20250619"],
      ["claude-opus-4-7", "claude-opus-4-6-20250619"],
      ["claude-haiku-4-5", "claude-haiku-4-5-20251001"],
    ];
    for (const [stored, expected] of cases) {
      await writeFile(
        join(tmpHome, "config.json"),
        JSON.stringify({
          version: CONFIG_VERSION,
          onboardedAt: "2026-05-17T00:00:00.000Z",
          provider: "anthropic",
          model: stored,
        }),
      );
      const c = await loadConfig();
      expect(c.model).toBe(expected);
    }
  });

  it("leaves non-legacy model IDs unchanged", async () => {
    await writeFile(
      join(tmpHome, "config.json"),
      JSON.stringify({
        version: CONFIG_VERSION,
        onboardedAt: "2026-05-17T00:00:00.000Z",
        provider: "openai",
        model: "gpt-4o",
      }),
    );
    const c = await loadConfig();
    expect(c.model).toBe("gpt-4o");
  });
});

describe("saveConfig", () => {
  it("stamps onboardedAt when not provided", async () => {
    await saveConfig({ version: CONFIG_VERSION, provider: "openai" });
    const c = await loadConfig();
    expect(c.onboardedAt).toBeDefined();
    expect(c.provider).toBe("openai");
  });

  it("preserves onboardedAt when explicitly provided", async () => {
    const stamp = "2026-05-17T00:00:00.000Z";
    await saveConfig({ version: CONFIG_VERSION, onboardedAt: stamp });
    const c = await loadConfig();
    expect(c.onboardedAt).toBe(stamp);
  });

  it("creates the OCTOPUS_HOME directory when missing", async () => {
    await rm(tmpHome, { recursive: true, force: true });
    await saveConfig({ version: CONFIG_VERSION });
    const c = await loadConfig();
    expect(c.onboardedAt).toBeDefined();
  });
});
