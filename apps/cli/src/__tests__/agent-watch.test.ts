import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWatchConfig } from "../lib/agent-watch";
import { getAgentWatchPath, setActiveProfileOverride } from "../lib/paths";

let tmpHome: string;

beforeEach(async () => {
  tmpHome = await mkdtemp(join(tmpdir(), "octp-watch-"));
  process.env.OCTOPUS_HOME = tmpHome;
  setActiveProfileOverride(null);
  // active profile resolves to "default" with no index
  await mkdir(join(tmpHome, "profiles", "default"), { recursive: true });
});

afterEach(async () => {
  delete process.env.OCTOPUS_HOME;
  setActiveProfileOverride(null);
  await rm(tmpHome, { recursive: true, force: true });
});

describe("loadWatchConfig", () => {
  it("loads well-formed entries", async () => {
    await writeFile(
      getAgentWatchPath(),
      JSON.stringify({
        entries: [
          { path: "/x", remoteUrl: "git@github.com:o/r.git", repoFullName: "o/r", addedAt: "t" },
        ],
      }),
    );
    const cfg = await loadWatchConfig();
    expect(cfg.entries).toHaveLength(1);
    expect(cfg.entries[0].repoFullName).toBe("o/r");
  });

  it("returns empty on missing / garbage / array, and drops malformed entries", async () => {
    expect((await loadWatchConfig()).entries).toEqual([]); // missing file
    await writeFile(getAgentWatchPath(), "not json");
    expect((await loadWatchConfig()).entries).toEqual([]);
    await writeFile(getAgentWatchPath(), JSON.stringify({ entries: "nope" }));
    expect((await loadWatchConfig()).entries).toEqual([]);
    await writeFile(
      getAgentWatchPath(),
      JSON.stringify({ entries: [{ path: "/ok", repoFullName: "o/r" }, { nope: 1 }, "x"] }),
    );
    const cfg = await loadWatchConfig();
    expect(cfg.entries).toHaveLength(1);
    expect(cfg.entries[0].path).toBe("/ok");
  });
});
